/**
 * Lua scripts for atomic Redis operations.
 * These scripts implement pool-based slot allocation where Redis tracks per-model
 * capacity and local instances distribute across job types using local ratios.
 */

/**
 * Pool-based reallocation logic.
 * Calculates per-model pool allocations (no job type dimension in Redis).
 *
 * Formula: pools[model].totalSlots = floor((modelCapacity / avgEstimatedResource) / instanceCount)
 *
 * Config keys used:
 * - {prefix}:model-capacities - Hash of modelId -> JSON {tokensPerMinute, requestsPerMinute, maxConcurrentRequests, tokensPerDay, requestsPerDay}
 * - {prefix}:job-type-resources - Hash of jobTypeId -> JSON {estimatedUsedTokens, estimatedNumberOfRequests, ratio}
 */
const REALLOCATION_LOGIC = `
-- Helper: Get global actual usage for a model from Redis counters
local function getGlobalUsage(prefix, modelId, timestamp)
  local MS_PER_MINUTE = 60000
  local MS_PER_DAY = 86400000
  local minuteWindow = math.floor(timestamp / MS_PER_MINUTE) * MS_PER_MINUTE
  local dayWindow = math.floor(timestamp / MS_PER_DAY) * MS_PER_DAY

  local tpmKey = prefix .. 'usage:' .. modelId .. ':tpm:' .. minuteWindow
  local rpmKey = prefix .. 'usage:' .. modelId .. ':rpm:' .. minuteWindow
  local tpdKey = prefix .. 'usage:' .. modelId .. ':tpd:' .. dayWindow
  local rpdKey = prefix .. 'usage:' .. modelId .. ':rpd:' .. dayWindow

  return {
    tpmUsed = tonumber(redis.call('HGET', tpmKey, 'actualTokens')) or 0,
    rpmUsed = tonumber(redis.call('HGET', rpmKey, 'actualRequests')) or 0,
    tpdUsed = tonumber(redis.call('HGET', tpdKey, 'actualTokens')) or 0,
    rpdUsed = tonumber(redis.call('HGET', rpdKey, 'actualRequests')) or 0
  }
end

-- Helper: Get average estimated resources across all job types
local function getAverageEstimates(jobTypeResources)
  local totalTokens = 0
  local totalRequests = 0
  local count = 0
  for _, jt in pairs(jobTypeResources) do
    totalTokens = totalTokens + (jt.estimatedUsedTokens or 1)
    totalRequests = totalRequests + (jt.estimatedNumberOfRequests or 1)
    count = count + 1
  end
  return {
    tokens = count > 0 and math.floor(totalTokens / count) or 1,
    requests = count > 0 and math.floor(totalRequests / count) or 1
  }
end

-- Calculate pool-based slot allocations (per-model, no job type dimension)
local function recalculateAllocations(instancesKey, allocationsKey, channel, modelCapacitiesKey, jobTypeResourcesKey)
  -- Get instance count
  local instancesData = redis.call('HGETALL', instancesKey)
  local instanceCount = 0
  local instanceIds = {}

  for i = 1, #instancesData, 2 do
    instanceCount = instanceCount + 1
    local instId = instancesData[i]
    table.insert(instanceIds, instId)
  end

  if instanceCount == 0 then return end

  -- Get model capacities
  local modelCapacitiesData = redis.call('HGETALL', modelCapacitiesKey)
  local modelCapacities = {}
  local modelIds = {}
  for i = 1, #modelCapacitiesData, 2 do
    local modelId = modelCapacitiesData[i]
    table.insert(modelIds, modelId)
    modelCapacities[modelId] = cjson.decode(modelCapacitiesData[i+1])
  end

  -- Get job type resources (for average estimate calculation only)
  local jobTypeResourcesData = redis.call('HGETALL', jobTypeResourcesKey)
  local jobTypeResources = {}
  for i = 1, #jobTypeResourcesData, 2 do
    local jobTypeId = jobTypeResourcesData[i]
    jobTypeResources[jobTypeId] = cjson.decode(jobTypeResourcesData[i+1])
  end

  -- Calculate average estimates across all job types
  local avgEstimates = getAverageEstimates(jobTypeResources)

  -- Extract prefix from instancesKey (e.g., "myprefix:instances" -> "myprefix:")
  local prefix = string.match(instancesKey, '^(.-)instances$') or ''
  local timestamp = tonumber(redis.call('TIME')[1]) * 1000

  -- Build dynamicLimits and pools based on remaining global capacity
  local dynamicLimits = {}
  local pools = {}

  for _, modelId in ipairs(modelIds) do
    local model = modelCapacities[modelId]
    local usage = getGlobalUsage(prefix, modelId, timestamp)
    dynamicLimits[modelId] = {}

    -- Calculate remaining capacity per instance: (globalLimit - actualUsage) / instanceCount
    local tpm = 0
    local rpm = 0
    local tpd = 0
    local rpd = 0

    if model.tokensPerMinute then
      local remaining = math.max(0, model.tokensPerMinute - usage.tpmUsed)
      tpm = math.floor(remaining / instanceCount)
      dynamicLimits[modelId].tokensPerMinute = tpm
    end
    if model.requestsPerMinute then
      local remaining = math.max(0, model.requestsPerMinute - usage.rpmUsed)
      rpm = math.floor(remaining / instanceCount)
      dynamicLimits[modelId].requestsPerMinute = rpm
    end
    if model.tokensPerDay then
      local remaining = math.max(0, model.tokensPerDay - usage.tpdUsed)
      tpd = math.floor(remaining / instanceCount)
      dynamicLimits[modelId].tokensPerDay = tpd
    end
    if model.requestsPerDay then
      local remaining = math.max(0, model.requestsPerDay - usage.rpdUsed)
      rpd = math.floor(remaining / instanceCount)
      dynamicLimits[modelId].requestsPerDay = rpd
    end

    -- Calculate pool slots (no ratio - that's applied locally)
    local slotCandidates = {}

    -- Concurrent-based slots
    if model.maxConcurrentRequests and model.maxConcurrentRequests > 0 then
      table.insert(slotCandidates, math.floor(model.maxConcurrentRequests / instanceCount))
    end

    -- TPM-based slots using average estimated tokens
    if tpm > 0 then
      table.insert(slotCandidates, math.floor(tpm / avgEstimates.tokens))
    end

    -- RPM-based slots using average estimated requests
    if rpm > 0 then
      table.insert(slotCandidates, math.floor(rpm / avgEstimates.requests))
    end

    -- TPD-based slots
    if tpd > 0 then
      table.insert(slotCandidates, math.floor(tpd / avgEstimates.tokens))
    end

    -- RPD-based slots
    if rpd > 0 then
      table.insert(slotCandidates, math.floor(rpd / avgEstimates.requests))
    end

    -- Use minimum of all candidates or fallback to 100
    local totalSlots = 100
    if #slotCandidates > 0 then
      totalSlots = slotCandidates[1]
      for _, candidate in ipairs(slotCandidates) do
        if candidate < totalSlots then
          totalSlots = candidate
        end
      end
    end

    pools[modelId] = {
      totalSlots = totalSlots,
      tokensPerMinute = tpm,
      requestsPerMinute = rpm,
      tokensPerDay = tpd,
      requestsPerDay = rpd
    }
  end

  -- Store allocation for each instance (same pools for all instances)
  for _, instId in ipairs(instanceIds) do
    local allocData = cjson.encode({
      instanceCount = instanceCount,
      pools = pools,
      dynamicLimits = dynamicLimits
    })
    redis.call('HSET', allocationsKey, instId, allocData)
    -- Publish update
    redis.call('PUBLISH', channel, cjson.encode({instanceId=instId, allocation=allocData}))
  end
end
`;

/**
 * Initialize multi-dimensional config (model capacities and job type resources).
 * KEYS: [modelCapacities, jobTypeResources]
 * ARGV: [modelCapacitiesJson, jobTypeResourcesJson]
 * Returns: "OK"
 */
export const INIT_CONFIG_SCRIPT = `
local modelCapacitiesKey = KEYS[1]
local jobTypeResourcesKey = KEYS[2]
local modelCapacitiesJson = ARGV[1]
local jobTypeResourcesJson = ARGV[2]

-- Clear existing and set new model capacities
redis.call('DEL', modelCapacitiesKey)
local modelCapacities = cjson.decode(modelCapacitiesJson)
for modelId, config in pairs(modelCapacities) do
  redis.call('HSET', modelCapacitiesKey, modelId, cjson.encode(config))
end

-- Clear existing and set new job type resources
redis.call('DEL', jobTypeResourcesKey)
local jobTypeResources = cjson.decode(jobTypeResourcesJson)
for jobTypeId, config in pairs(jobTypeResources) do
  redis.call('HSET', jobTypeResourcesKey, jobTypeId, cjson.encode(config))
end

return 'OK'
`;

/**
 * Register a new instance and recalculate allocations.
 * KEYS: [instances, allocations, channel, modelCapacities, jobTypeResources]
 * ARGV: [instanceId, timestamp]
 * Returns: allocation JSON for this instance
 */
export const REGISTER_SCRIPT = `
${REALLOCATION_LOGIC}

local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local channel = KEYS[3]
local modelCapacitiesKey = KEYS[4]
local jobTypeResourcesKey = KEYS[5]
local instanceId = ARGV[1]
local timestamp = tonumber(ARGV[2])

-- Add instance with 0 in-flight (pool-based: track by model only)
local instanceData = {
  lastHeartbeat = timestamp,
  inFlightByModel = {}
}
redis.call('HSET', instancesKey, instanceId, cjson.encode(instanceData))

-- Recalculate allocations
recalculateAllocations(instancesKey, allocationsKey, channel, modelCapacitiesKey, jobTypeResourcesKey)

-- Return this instance's allocation
local allocJson = redis.call('HGET', allocationsKey, instanceId)
return allocJson or cjson.encode({instanceCount=0, pools={}})
`;

/**
 * Unregister an instance and recalculate allocations.
 * KEYS: [instances, allocations, channel, modelCapacities, jobTypeResources]
 * ARGV: [instanceId]
 * Returns: "OK"
 */
export const UNREGISTER_SCRIPT = `
${REALLOCATION_LOGIC}

local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local channel = KEYS[3]
local modelCapacitiesKey = KEYS[4]
local jobTypeResourcesKey = KEYS[5]
local instanceId = ARGV[1]

-- Remove instance
redis.call('HDEL', instancesKey, instanceId)
redis.call('HDEL', allocationsKey, instanceId)

-- Recalculate remaining allocations
recalculateAllocations(instancesKey, allocationsKey, channel, modelCapacitiesKey, jobTypeResourcesKey)

return 'OK'
`;

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
if not poolAlloc or poolAlloc.totalSlots <= 0 then return "0" end

-- Decrement pool slot
poolAlloc.totalSlots = poolAlloc.totalSlots - 1
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
 * KEYS: [instances, allocations, channel, modelCapacities, jobTypeResources]
 * ARGV: [cutoffTimestamp]
 * Returns: number of instances removed
 */
export const CLEANUP_SCRIPT = `
${REALLOCATION_LOGIC}

local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local channel = KEYS[3]
local modelCapacitiesKey = KEYS[4]
local jobTypeResourcesKey = KEYS[5]
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
  recalculateAllocations(instancesKey, allocationsKey, channel, modelCapacitiesKey, jobTypeResourcesKey)
end

return removed
`;

/**
 * Get all instances data for stats (pool-based).
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
  local pools = nil
  if allocJson then
    local allocData = cjson.decode(allocJson)
    pools = allocData.pools
    -- Sum total slots across all pools
    if pools then
      for _, pool in pairs(pools) do
        allocation = allocation + (pool.totalSlots or 0)
      end
    end
  end

  -- Count total in-flight from pool-based tracking (by model)
  local inFlight = 0
  if instData.inFlightByModel then
    for _, count in pairs(instData.inFlightByModel) do
      inFlight = inFlight + count
    end
  end

  totalInFlight = totalInFlight + inFlight
  totalAllocated = totalAllocated + allocation

  table.insert(stats, {
    id = instId,
    inFlight = inFlight,
    inFlightByModel = instData.inFlightByModel,
    allocation = allocation,
    pools = pools,
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
