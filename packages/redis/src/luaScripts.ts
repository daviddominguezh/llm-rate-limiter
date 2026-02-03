/**
 * Lua scripts for atomic Redis operations.
 * These scripts implement the fair distribution algorithm.
 */

/**
 * Shared reallocation logic (used in multiple scripts).
 * Calculates fair-share allocations based on instance needs.
 */
const REALLOCATION_LOGIC = `
-- Recalculate allocations using fair distribution algorithm
local function recalculateAllocations(instancesKey, allocationsKey, channel, totalCapacity, tokensPerMinute, requestsPerMinute)
  local instancesData = redis.call('HGETALL', instancesKey)
  local instanceCount = 0
  local instanceList = {}

  for i = 1, #instancesData, 2 do
    instanceCount = instanceCount + 1
    local data = cjson.decode(instancesData[i+1])
    table.insert(instanceList, {id=instancesData[i], inFlight=data.inFlight})
  end

  if instanceCount == 0 then return end

  local fairShare = math.floor(totalCapacity / instanceCount)
  local totalInFlight = 0
  local totalNeed = 0
  local needs = {}

  for _, inst in ipairs(instanceList) do
    totalInFlight = totalInFlight + inst.inFlight
    local need = math.max(0, fairShare - inst.inFlight)
    table.insert(needs, {id=inst.id, need=need})
    totalNeed = totalNeed + need
  end

  local available = math.max(0, totalCapacity - totalInFlight)

  for _, n in ipairs(needs) do
    local allocation = 0
    if totalNeed > 0 then
      allocation = math.floor((n.need / totalNeed) * available)
    end
    -- Include instanceCount so clients can divide their model-specific limits
    local allocData = cjson.encode({
      slots=allocation,
      instanceCount=instanceCount
    })
    redis.call('HSET', allocationsKey, n.id, allocData)
    -- Publish update to subscribers
    redis.call('PUBLISH', channel, cjson.encode({instanceId=n.id, allocation=allocData}))
  end
end
`;

/**
 * Register a new instance and recalculate allocations.
 * KEYS: [instances, allocations, config, channel]
 * ARGV: [instanceId, timestamp, totalCapacity, tokensPerMinute, requestsPerMinute]
 * Returns: allocation JSON for this instance
 */
export const REGISTER_SCRIPT = `
${REALLOCATION_LOGIC}

local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local configKey = KEYS[3]
local channel = KEYS[4]
local instanceId = ARGV[1]
local timestamp = tonumber(ARGV[2])
local totalCapacity = tonumber(ARGV[3])
local tokensPerMinute = tonumber(ARGV[4])
local requestsPerMinute = tonumber(ARGV[5])

-- Store config
redis.call('HSET', configKey, 'totalCapacity', totalCapacity)
redis.call('HSET', configKey, 'tokensPerMinute', tokensPerMinute)
redis.call('HSET', configKey, 'requestsPerMinute', requestsPerMinute)

-- Add instance with 0 in-flight
redis.call('HSET', instancesKey, instanceId, cjson.encode({inFlight=0, lastHeartbeat=timestamp}))

-- Recalculate all allocations
recalculateAllocations(instancesKey, allocationsKey, channel, totalCapacity, tokensPerMinute, requestsPerMinute)

-- Return this instance's allocation
local allocJson = redis.call('HGET', allocationsKey, instanceId)
return allocJson or cjson.encode({slots=0, tokensPerMinute=0, requestsPerMinute=0})
`;

/**
 * Unregister an instance and recalculate allocations.
 * KEYS: [instances, allocations, config, channel]
 * ARGV: [instanceId]
 * Returns: void
 */
export const UNREGISTER_SCRIPT = `
${REALLOCATION_LOGIC}

local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local configKey = KEYS[3]
local channel = KEYS[4]
local instanceId = ARGV[1]

-- Remove instance
redis.call('HDEL', instancesKey, instanceId)
redis.call('HDEL', allocationsKey, instanceId)

-- Get config for reallocation
local totalCapacity = tonumber(redis.call('HGET', configKey, 'totalCapacity') or 100)
local tokensPerMinute = tonumber(redis.call('HGET', configKey, 'tokensPerMinute') or 0)
local requestsPerMinute = tonumber(redis.call('HGET', configKey, 'requestsPerMinute') or 0)

-- Recalculate remaining allocations
recalculateAllocations(instancesKey, allocationsKey, channel, totalCapacity, tokensPerMinute, requestsPerMinute)

return 'OK'
`;

/**
 * Acquire a slot (decrement allocation, increment in-flight).
 * KEYS: [instances, allocations]
 * ARGV: [instanceId, timestamp]
 * Returns: "1" (success) or "0" (no capacity)
 */
export const ACQUIRE_SCRIPT = `
local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local instanceId = ARGV[1]
local timestamp = tonumber(ARGV[2])

-- Check allocation
local allocJson = redis.call('HGET', allocationsKey, instanceId)
if not allocJson then return "0" end

local alloc = cjson.decode(allocJson)
if alloc.slots <= 0 then return "0" end

-- Decrement allocation
alloc.slots = alloc.slots - 1
redis.call('HSET', allocationsKey, instanceId, cjson.encode(alloc))

-- Increment in-flight and update heartbeat
local instJson = redis.call('HGET', instancesKey, instanceId)
if not instJson then return "0" end

local inst = cjson.decode(instJson)
inst.inFlight = inst.inFlight + 1
inst.lastHeartbeat = timestamp
redis.call('HSET', instancesKey, instanceId, cjson.encode(inst))

return "1"
`;

/**
 * Release a slot (decrement in-flight) and recalculate allocations.
 * KEYS: [instances, allocations, config, channel]
 * ARGV: [instanceId, timestamp]
 * Returns: void
 */
export const RELEASE_SCRIPT = `
${REALLOCATION_LOGIC}

local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local configKey = KEYS[3]
local channel = KEYS[4]
local instanceId = ARGV[1]
local timestamp = tonumber(ARGV[2])

-- Decrement in-flight
local instJson = redis.call('HGET', instancesKey, instanceId)
if not instJson then return 'OK' end

local inst = cjson.decode(instJson)
inst.inFlight = math.max(0, inst.inFlight - 1)
inst.lastHeartbeat = timestamp
redis.call('HSET', instancesKey, instanceId, cjson.encode(inst))

-- Get config for reallocation
local totalCapacity = tonumber(redis.call('HGET', configKey, 'totalCapacity') or 100)
local tokensPerMinute = tonumber(redis.call('HGET', configKey, 'tokensPerMinute') or 0)
local requestsPerMinute = tonumber(redis.call('HGET', configKey, 'requestsPerMinute') or 0)

-- Recalculate all allocations
recalculateAllocations(instancesKey, allocationsKey, channel, totalCapacity, tokensPerMinute, requestsPerMinute)

return 'OK'
`;

/**
 * Send heartbeat to update instance's lastHeartbeat.
 * KEYS: [instances]
 * ARGV: [instanceId, timestamp]
 * Returns: "1" (success) or "0" (instance not found)
 */
export const HEARTBEAT_SCRIPT = `
local instancesKey = KEYS[1]
local instanceId = ARGV[1]
local timestamp = tonumber(ARGV[2])

local instJson = redis.call('HGET', instancesKey, instanceId)
if not instJson then return "0" end

local inst = cjson.decode(instJson)
inst.lastHeartbeat = timestamp
redis.call('HSET', instancesKey, instanceId, cjson.encode(inst))

return "1"
`;

/**
 * Cleanup stale instances and recalculate allocations.
 * KEYS: [instances, allocations, config, channel]
 * ARGV: [cutoffTimestamp]
 * Returns: number of instances removed
 */
export const CLEANUP_SCRIPT = `
${REALLOCATION_LOGIC}

local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local configKey = KEYS[3]
local channel = KEYS[4]
local cutoff = tonumber(ARGV[1])

local instancesData = redis.call('HGETALL', instancesKey)
local removed = 0

for i = 1, #instancesData, 2 do
  local data = cjson.decode(instancesData[i+1])
  if data.lastHeartbeat < cutoff then
    redis.call('HDEL', instancesKey, instancesData[i])
    redis.call('HDEL', allocationsKey, instancesData[i])
    removed = removed + 1
  end
end

if removed > 0 then
  -- Get config for reallocation
  local totalCapacity = tonumber(redis.call('HGET', configKey, 'totalCapacity') or 100)
  local tokensPerMinute = tonumber(redis.call('HGET', configKey, 'tokensPerMinute') or 0)
  local requestsPerMinute = tonumber(redis.call('HGET', configKey, 'requestsPerMinute') or 0)

  -- Recalculate remaining allocations
  recalculateAllocations(instancesKey, allocationsKey, channel, totalCapacity, tokensPerMinute, requestsPerMinute)
end

return removed
`;

/**
 * Get all instances data for stats.
 * KEYS: [instances, allocations]
 * Returns: JSON array of instance stats
 */
export const GET_STATS_SCRIPT = `
local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]

local instancesData = redis.call('HGETALL', instancesKey)
local stats = {}
local totalInFlight = 0
local totalAllocated = 0

for i = 1, #instancesData, 2 do
  local instId = instancesData[i]
  local instData = cjson.decode(instancesData[i+1])
  local allocJson = redis.call('HGET', allocationsKey, instId)
  local allocation = 0
  if allocJson then
    allocation = cjson.decode(allocJson).slots
  end

  totalInFlight = totalInFlight + instData.inFlight
  totalAllocated = totalAllocated + allocation

  table.insert(stats, {
    id = instId,
    inFlight = instData.inFlight,
    allocation = allocation,
    lastHeartbeat = instData.lastHeartbeat
  })
end

return cjson.encode({
  totalInstances = #stats,
  totalInFlight = totalInFlight,
  totalAllocated = totalAllocated,
  instances = stats
})
`;

// Re-export job type scripts from dedicated module
export {
  ACQUIRE_JOB_TYPE_SCRIPT,
  GET_JOB_TYPES_STATS_SCRIPT,
  INIT_JOB_TYPES_SCRIPT,
  RELEASE_JOB_TYPE_SCRIPT,
  SET_JOB_TYPE_CAPACITY_SCRIPT,
} from './jobTypeLuaScripts.js';
