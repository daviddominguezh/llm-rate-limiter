/**
 * Lua scripts for slot acquisition and release operations.
 */
import { REALLOCATION_LOGIC } from './luaReallocationLogic.js';

/**
 * Acquire a slot from a model's pool (pool-based: no job type dimension).
 * KEYS: [instances, allocations]
 * ARGV: [instanceId, timestamp, modelId]
 * Returns: "1" (success) or "0" (no capacity)
 */
export const ACQUIRE_SCRIPT = `
local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local instanceId = ARGV[1]
local timestamp = tonumber(ARGV[2])
local modelId = ARGV[3]

-- Check allocation
local allocJson = redis.call('HGET', allocationsKey, instanceId)
if not allocJson then return "0" end

local alloc = cjson.decode(allocJson)

-- Check pool slots (pool-based: per-model only)
if not alloc.pools then return "0" end
local poolAlloc = alloc.pools[modelId]
if not poolAlloc then return "0" end

-- Use acquirableSlots (in-flight-aware), fall back to totalSlots for backwards compat
local acquirable = poolAlloc.acquirableSlots
if acquirable == nil then acquirable = poolAlloc.totalSlots end
if not acquirable or acquirable <= 0 then
  -- Check if allocation is from a previous rate-limit window (minute boundary crossed)
  local MS_PER_MINUTE = 60000
  local now = tonumber(redis.call('TIME')[1]) * 1000
  local allocatedAt = alloc.allocatedAt or 0
  local isStale = allocatedAt > 0
    and math.floor(now / MS_PER_MINUTE) > math.floor(allocatedAt / MS_PER_MINUTE)
  if not isStale then return "0" end
  -- Allocation is stale — local limiter has already validated capacity.
  -- Allow acquisition; next reallocation will update the allocation.
end

-- Decrement acquirable slot (may go negative for stale window-boundary acquires)
poolAlloc.acquirableSlots = (acquirable or 0) - 1
redis.call('HSET', allocationsKey, instanceId, cjson.encode(alloc))

-- Increment in-flight
local instJson = redis.call('HGET', instancesKey, instanceId)
if not instJson then return "0" end

local inst = cjson.decode(instJson)
inst.lastHeartbeat = timestamp

-- Track in-flight by model (pool-based: no job type dimension)
if not inst.inFlightByModel then
  inst.inFlightByModel = {}
end
local current = inst.inFlightByModel[modelId] or 0
inst.inFlightByModel[modelId] = current + 1

redis.call('HSET', instancesKey, instanceId, cjson.encode(inst))

return "1"
`;

/**
 * Release a slot and recalculate allocations (pool-based: no job type dimension).
 * KEYS: [instances, allocations, channel, modelCapacities, jobTypeResources]
 * ARGV: [instanceId, timestamp, modelId, actualTokens, actualRequests,
 *        tpmWindowStart, rpmWindowStart, tpdWindowStart, rpdWindowStart]
 * Returns: "OK"
 */
export const RELEASE_SCRIPT = `
${REALLOCATION_LOGIC}

local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local channel = KEYS[3]
local modelCapacitiesKey = KEYS[4]
local jobTypeResourcesKey = KEYS[5]
local instanceId = ARGV[1]
local timestamp = tonumber(ARGV[2])
local modelId = ARGV[3]

-- Parse actual usage and window starts for distributed usage tracking
local actualTokens = tonumber(ARGV[4]) or 0
local actualRequests = tonumber(ARGV[5]) or 0
local tpmWindowStart = ARGV[6] or ''
local rpmWindowStart = ARGV[7] or ''
local tpdWindowStart = ARGV[8] or ''
local rpdWindowStart = ARGV[9] or ''

-- Update global usage counters (for distributed capacity tracking)
local prefix = string.match(instancesKey, '^(.-)instances$') or ''
local MINUTE_TTL = 120   -- 2 minutes
local DAY_TTL = 90000    -- 25 hours

-- Track token usage (TPM and TPD)
if actualTokens > 0 then
  if tpmWindowStart ~= '' then
    local tpmKey = prefix .. 'usage:' .. modelId .. ':tpm:' .. tpmWindowStart
    redis.call('HINCRBY', tpmKey, 'actualTokens', actualTokens)
    redis.call('HSET', tpmKey, 'lastUpdate', timestamp)
    redis.call('EXPIRE', tpmKey, MINUTE_TTL)
  end
  if tpdWindowStart ~= '' then
    local tpdKey = prefix .. 'usage:' .. modelId .. ':tpd:' .. tpdWindowStart
    redis.call('HINCRBY', tpdKey, 'actualTokens', actualTokens)
    redis.call('HSET', tpdKey, 'lastUpdate', timestamp)
    redis.call('EXPIRE', tpdKey, DAY_TTL)
  end
end

-- Track request usage (RPM and RPD)
if actualRequests > 0 then
  if rpmWindowStart ~= '' then
    local rpmKey = prefix .. 'usage:' .. modelId .. ':rpm:' .. rpmWindowStart
    redis.call('HINCRBY', rpmKey, 'actualRequests', actualRequests)
    redis.call('HSET', rpmKey, 'lastUpdate', timestamp)
    redis.call('EXPIRE', rpmKey, MINUTE_TTL)
  end
  if rpdWindowStart ~= '' then
    local rpdKey = prefix .. 'usage:' .. modelId .. ':rpd:' .. rpdWindowStart
    redis.call('HINCRBY', rpdKey, 'actualRequests', actualRequests)
    redis.call('HSET', rpdKey, 'lastUpdate', timestamp)
    redis.call('EXPIRE', rpdKey, DAY_TTL)
  end
end

-- Decrement in-flight (pool-based: by model only)
local instJson = redis.call('HGET', instancesKey, instanceId)
if not instJson then return 'OK' end

local inst = cjson.decode(instJson)
inst.lastHeartbeat = timestamp

-- Track in-flight by model (pool-based: no job type dimension)
if inst.inFlightByModel then
  local current = inst.inFlightByModel[modelId] or 0
  inst.inFlightByModel[modelId] = math.max(0, current - 1)
end

redis.call('HSET', instancesKey, instanceId, cjson.encode(inst))

-- Recalculate allocations (now considers actual usage via dynamicLimits)
recalculateAllocations(instancesKey, allocationsKey, channel, modelCapacitiesKey, jobTypeResourcesKey)

return 'OK'
`;
