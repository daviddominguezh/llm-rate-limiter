/**
 * Lua scripts for atomic Redis operations.
 * These scripts implement the multi-dimensional fair distribution algorithm.
 */

/**
 * Multi-dimensional reallocation logic.
 * Calculates per-job-type per-model slot allocations.
 *
 * Formula: slots[jobType][model] = floor((modelCapacity / estimatedResource) / instanceCount * ratio)
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

-- Calculate multi-dimensional slot allocations
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

  -- Get job type resources
  local jobTypeResourcesData = redis.call('HGETALL', jobTypeResourcesKey)
  local jobTypeResources = {}
  local jobTypeIds = {}
  for i = 1, #jobTypeResourcesData, 2 do
    local jobTypeId = jobTypeResourcesData[i]
    table.insert(jobTypeIds, jobTypeId)
    jobTypeResources[jobTypeId] = cjson.decode(jobTypeResourcesData[i+1])
  end

  -- Extract prefix from instancesKey (e.g., "myprefix:instances" -> "myprefix:")
  local prefix = string.match(instancesKey, '^(.-)instances$') or ''
  local timestamp = tonumber(redis.call('TIME')[1]) * 1000

  -- Build dynamicLimits based on remaining global capacity after actual usage
  local dynamicLimits = {}
  for _, modelId in ipairs(modelIds) do
    local model = modelCapacities[modelId]
    local usage = getGlobalUsage(prefix, modelId, timestamp)
    dynamicLimits[modelId] = {}

    -- Calculate remaining capacity: (globalLimit - actualUsage) / instanceCount
    if model.tokensPerMinute then
      local remaining = math.max(0, model.tokensPerMinute - usage.tpmUsed)
      dynamicLimits[modelId].tokensPerMinute = math.floor(remaining / instanceCount)
    end
    if model.requestsPerMinute then
      local remaining = math.max(0, model.requestsPerMinute - usage.rpmUsed)
      dynamicLimits[modelId].requestsPerMinute = math.floor(remaining / instanceCount)
    end
    if model.tokensPerDay then
      local remaining = math.max(0, model.tokensPerDay - usage.tpdUsed)
      dynamicLimits[modelId].tokensPerDay = math.floor(remaining / instanceCount)
    end
    if model.requestsPerDay then
      local remaining = math.max(0, model.requestsPerDay - usage.rpdUsed)
      dynamicLimits[modelId].requestsPerDay = math.floor(remaining / instanceCount)
    end
  end

  -- Calculate slots for each instance
  for _, instId in ipairs(instanceIds) do
    local slotsByJobTypeAndModel = {}

    for _, jobTypeId in ipairs(jobTypeIds) do
      local jobType = jobTypeResources[jobTypeId]
      local ratio = jobType.ratio or (1 / #jobTypeIds)
      slotsByJobTypeAndModel[jobTypeId] = {}

      for _, modelId in ipairs(modelIds) do
        local model = modelCapacities[modelId]
        local estimatedTokens = jobType.estimatedUsedTokens or 1
        local estimatedRequests = jobType.estimatedNumberOfRequests or 1
        local modelDynamic = dynamicLimits[modelId] or {}

        -- Calculate slot candidates from each limit type using REMAINING capacity
        local slotCandidates = {}
        local tpm = modelDynamic.tokensPerMinute or 0
        local rpm = modelDynamic.requestsPerMinute or 0
        local tpd = modelDynamic.tokensPerDay or 0
        local rpd = modelDynamic.requestsPerDay or 0

        -- Concurrent-based slots (direct capacity, no resource division)
        if model.maxConcurrentRequests and model.maxConcurrentRequests > 0 then
          local concurrentSlots = math.floor(model.maxConcurrentRequests / instanceCount * ratio)
          table.insert(slotCandidates, concurrentSlots)
        end

        -- TPM-based slots using remaining capacity
        if tpm > 0 then
          local tpmSlots = math.floor(tpm / estimatedTokens * ratio)
          table.insert(slotCandidates, tpmSlots)
        end

        -- RPM-based slots using remaining capacity
        if rpm > 0 then
          local rpmSlots = math.floor(rpm / estimatedRequests * ratio)
          table.insert(slotCandidates, rpmSlots)
        end

        -- TPD-based slots using remaining capacity
        if tpd > 0 then
          local tpdSlots = math.floor(tpd / estimatedTokens * ratio)
          table.insert(slotCandidates, tpdSlots)
        end

        -- RPD-based slots using remaining capacity
        if rpd > 0 then
          local rpdSlots = math.floor(rpd / estimatedRequests * ratio)
          table.insert(slotCandidates, rpdSlots)
        end

        -- Use minimum of all candidates (most restrictive limit) or fallback to 100
        local slots = 100
        if #slotCandidates > 0 then
          slots = slotCandidates[1]
          for _, candidate in ipairs(slotCandidates) do
            if candidate < slots then
              slots = candidate
            end
          end
        end

        slotsByJobTypeAndModel[jobTypeId][modelId] = {
          slots = slots,
          tokensPerMinute = tpm,
          requestsPerMinute = rpm,
          tokensPerDay = tpd,
          requestsPerDay = rpd
        }
      end
    end

    -- Store allocation with dynamicLimits for instances to update local rate limiters
    local allocData = cjson.encode({
      instanceCount = instanceCount,
      slotsByJobTypeAndModel = slotsByJobTypeAndModel,
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

-- Add instance with 0 in-flight
local instanceData = {
  lastHeartbeat = timestamp,
  inFlightByJobTypeAndModel = {}
}
redis.call('HSET', instancesKey, instanceId, cjson.encode(instanceData))

-- Recalculate allocations
recalculateAllocations(instancesKey, allocationsKey, channel, modelCapacitiesKey, jobTypeResourcesKey)

-- Return this instance's allocation
local allocJson = redis.call('HGET', allocationsKey, instanceId)
return allocJson or cjson.encode({slots=0, instanceCount=0, slotsByJobTypeAndModel={}})
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
 * Acquire a slot for a specific job type and model.
 * KEYS: [instances, allocations]
 * ARGV: [instanceId, timestamp, jobType, modelId]
 * Returns: "1" (success) or "0" (no capacity)
 */
export const ACQUIRE_SCRIPT = `
local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local instanceId = ARGV[1]
local timestamp = tonumber(ARGV[2])
local jobType = ARGV[3]
local modelId = ARGV[4]

-- Check allocation
local allocJson = redis.call('HGET', allocationsKey, instanceId)
if not allocJson then return "0" end

local alloc = cjson.decode(allocJson)

-- Check multi-dimensional slots
if not alloc.slotsByJobTypeAndModel then return "0" end
local jobTypeAlloc = alloc.slotsByJobTypeAndModel[jobType]
if not jobTypeAlloc then return "0" end
local modelAlloc = jobTypeAlloc[modelId]
if not modelAlloc or modelAlloc.slots <= 0 then return "0" end

-- Decrement slot
modelAlloc.slots = modelAlloc.slots - 1
redis.call('HSET', allocationsKey, instanceId, cjson.encode(alloc))

-- Increment in-flight
local instJson = redis.call('HGET', instancesKey, instanceId)
if not instJson then return "0" end

local inst = cjson.decode(instJson)
inst.lastHeartbeat = timestamp

-- Track in-flight by job type and model
if not inst.inFlightByJobTypeAndModel then
  inst.inFlightByJobTypeAndModel = {}
end
if not inst.inFlightByJobTypeAndModel[jobType] then
  inst.inFlightByJobTypeAndModel[jobType] = {}
end
local current = inst.inFlightByJobTypeAndModel[jobType][modelId] or 0
inst.inFlightByJobTypeAndModel[jobType][modelId] = current + 1

redis.call('HSET', instancesKey, instanceId, cjson.encode(inst))

return "1"
`;

/**
 * Release a slot and recalculate allocations.
 * KEYS: [instances, allocations, channel, modelCapacities, jobTypeResources]
 * ARGV: [instanceId, timestamp, jobType, modelId, actualTokens, actualRequests,
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
local jobType = ARGV[3]
local modelId = ARGV[4]

-- Parse actual usage and window starts for distributed usage tracking
local actualTokens = tonumber(ARGV[5]) or 0
local actualRequests = tonumber(ARGV[6]) or 0
local tpmWindowStart = ARGV[7] or ''
local rpmWindowStart = ARGV[8] or ''
local tpdWindowStart = ARGV[9] or ''
local rpdWindowStart = ARGV[10] or ''

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

-- Decrement in-flight
local instJson = redis.call('HGET', instancesKey, instanceId)
if not instJson then return 'OK' end

local inst = cjson.decode(instJson)
inst.lastHeartbeat = timestamp

-- Track in-flight by job type and model
if inst.inFlightByJobTypeAndModel and inst.inFlightByJobTypeAndModel[jobType] then
  local current = inst.inFlightByJobTypeAndModel[jobType][modelId] or 0
  inst.inFlightByJobTypeAndModel[jobType][modelId] = math.max(0, current - 1)
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
  local slotsByJobTypeAndModel = nil
  if allocJson then
    local allocData = cjson.decode(allocJson)
    allocation = allocData.slots
    slotsByJobTypeAndModel = allocData.slotsByJobTypeAndModel
  end

  -- Count total in-flight from multi-dimensional tracking
  local inFlight = 0
  if instData.inFlightByJobTypeAndModel then
    for _, jobTypeInFlight in pairs(instData.inFlightByJobTypeAndModel) do
      for _, count in pairs(jobTypeInFlight) do
        inFlight = inFlight + count
      end
    end
  end

  totalInFlight = totalInFlight + inFlight
  totalAllocated = totalAllocated + allocation

  table.insert(stats, {
    id = instId,
    inFlight = inFlight,
    inFlightByJobTypeAndModel = instData.inFlightByJobTypeAndModel,
    allocation = allocation,
    slotsByJobTypeAndModel = slotsByJobTypeAndModel,
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
