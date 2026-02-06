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
export const REALLOCATION_LOGIC = `
-- Helper: Check if value is a valid number (not nil, not cjson.null)
local function isValidNumber(val)
  return type(val) == 'number'
end

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

    if isValidNumber(model.tokensPerMinute) then
      local baseAllocation = math.floor(model.tokensPerMinute / instanceCount)
      local remaining = math.max(0, model.tokensPerMinute - usage.tpmUsed)
      tpm = math.max(baseAllocation, math.floor(remaining / instanceCount))
      dynamicLimits[modelId].tokensPerMinute = tpm
    end
    if isValidNumber(model.requestsPerMinute) then
      local baseAllocation = math.floor(model.requestsPerMinute / instanceCount)
      local remaining = math.max(0, model.requestsPerMinute - usage.rpmUsed)
      rpm = math.max(baseAllocation, math.floor(remaining / instanceCount))
      dynamicLimits[modelId].requestsPerMinute = rpm
    end
    if isValidNumber(model.tokensPerDay) then
      local baseAllocation = math.floor(model.tokensPerDay / instanceCount)
      local remaining = math.max(0, model.tokensPerDay - usage.tpdUsed)
      tpd = math.max(baseAllocation, math.floor(remaining / instanceCount))
      dynamicLimits[modelId].tokensPerDay = tpd
    end
    if isValidNumber(model.requestsPerDay) then
      local baseAllocation = math.floor(model.requestsPerDay / instanceCount)
      local remaining = math.max(0, model.requestsPerDay - usage.rpdUsed)
      rpd = math.max(baseAllocation, math.floor(remaining / instanceCount))
      dynamicLimits[modelId].requestsPerDay = rpd
    end

    -- Calculate pool slots (no ratio - that's applied locally)
    local slotCandidates = {}

    -- Concurrent-based slots
    if isValidNumber(model.maxConcurrentRequests) and model.maxConcurrentRequests > 0 then
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
