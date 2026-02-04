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
 * - {prefix}:model-capacities - Hash of modelId -> JSON {tokensPerMinute, requestsPerMinute, maxConcurrentRequests}
 * - {prefix}:job-type-resources - Hash of jobTypeId -> JSON {estimatedUsedTokens, estimatedNumberOfRequests, ratio}
 */
const REALLOCATION_LOGIC = `
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

  -- Calculate slots for each instance
  for _, instId in ipairs(instanceIds) do
    local slotsByJobTypeAndModel = {}
    local totalSlots = 0

    for _, jobTypeId in ipairs(jobTypeIds) do
      local jobType = jobTypeResources[jobTypeId]
      local ratio = jobType.ratio or (1 / #jobTypeIds)
      slotsByJobTypeAndModel[jobTypeId] = {}

      for _, modelId in ipairs(modelIds) do
        local model = modelCapacities[modelId]
        local estimatedTokens = jobType.estimatedUsedTokens or 1
        local estimatedRequests = jobType.estimatedNumberOfRequests or 1

        -- Calculate base capacity from the limiting factor
        local baseCapacity = 0
        local tpm = 0
        local rpm = 0

        if model.maxConcurrentRequests and model.maxConcurrentRequests > 0 then
          -- Concurrent-limited model
          baseCapacity = model.maxConcurrentRequests
        elseif model.tokensPerMinute and model.tokensPerMinute > 0 then
          -- TPM-limited model: capacity = TPM / tokens per job
          baseCapacity = math.floor(model.tokensPerMinute / estimatedTokens)
        elseif model.requestsPerMinute and model.requestsPerMinute > 0 then
          -- RPM-limited model: capacity = RPM / requests per job
          baseCapacity = math.floor(model.requestsPerMinute / estimatedRequests)
        else
          baseCapacity = 100 -- fallback
        end

        -- Apply instance distribution and ratio
        local perInstanceCapacity = math.floor(baseCapacity / instanceCount)
        local slots = math.floor(perInstanceCapacity * ratio)

        -- Calculate per-instance TPM/RPM limits
        if model.tokensPerMinute then
          tpm = math.floor(model.tokensPerMinute / instanceCount)
        end
        if model.requestsPerMinute then
          rpm = math.floor(model.requestsPerMinute / instanceCount)
        end

        slotsByJobTypeAndModel[jobTypeId][modelId] = {
          slots = slots,
          tokensPerMinute = tpm,
          requestsPerMinute = rpm
        }
        totalSlots = totalSlots + slots
      end
    end

    -- Store allocation
    local allocData = cjson.encode({
      slots = totalSlots,
      instanceCount = instanceCount,
      slotsByJobTypeAndModel = slotsByJobTypeAndModel
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
alloc.slots = alloc.slots - 1
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
 * ARGV: [instanceId, timestamp, jobType, modelId]
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

-- Recalculate allocations
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
