/**
 * Lua scripts for job type operations in Redis.
 * These scripts handle distributed job type capacity management.
 */

/**
 * Initialize job types from configuration.
 * KEYS: [jobTypesKey]
 * ARGV: [jobTypesJson] - JSON object with job type IDs and their config
 * Returns: "OK"
 */
export const INIT_JOB_TYPES_SCRIPT = `
local jobTypesKey = KEYS[1]
local jobTypesJson = ARGV[1]

local jobTypes = cjson.decode(jobTypesJson)
for jobTypeId, config in pairs(jobTypes) do
  local state = {
    currentRatio = config.currentRatio or 0,
    initialRatio = config.initialRatio or 0,
    flexible = config.flexible,
    totalInFlight = 0,
    allocatedSlots = 0
  }
  redis.call('HSET', jobTypesKey, jobTypeId, cjson.encode(state))
end

return 'OK'
`;

/**
 * Acquire a job type slot.
 * KEYS: [jobTypesKey, instanceJobTypesKey]
 * ARGV: [instanceId, jobTypeId]
 * Returns: "1" (success) or "0" (no capacity)
 */
export const ACQUIRE_JOB_TYPE_SCRIPT = `
local jobTypesKey = KEYS[1]
local instanceJobTypesKey = KEYS[2]
local instanceId = ARGV[1]
local jobTypeId = ARGV[2]

-- Get job type state
local stateJson = redis.call('HGET', jobTypesKey, jobTypeId)
if not stateJson then return "0" end

local state = cjson.decode(stateJson)
if state.totalInFlight >= state.allocatedSlots then return "0" end

-- Increment global in-flight
state.totalInFlight = state.totalInFlight + 1
redis.call('HSET', jobTypesKey, jobTypeId, cjson.encode(state))

-- Increment instance in-flight for this job type
local instanceKey = instanceJobTypesKey .. ':' .. instanceId
local currentInFlight = tonumber(redis.call('HGET', instanceKey, jobTypeId) or "0")
redis.call('HSET', instanceKey, jobTypeId, currentInFlight + 1)

return "1"
`;

/**
 * Release a job type slot.
 * KEYS: [jobTypesKey, instanceJobTypesKey]
 * ARGV: [instanceId, jobTypeId]
 * Returns: "OK"
 */
export const RELEASE_JOB_TYPE_SCRIPT = `
local jobTypesKey = KEYS[1]
local instanceJobTypesKey = KEYS[2]
local instanceId = ARGV[1]
local jobTypeId = ARGV[2]

-- Get job type state
local stateJson = redis.call('HGET', jobTypesKey, jobTypeId)
if not stateJson then return 'OK' end

local state = cjson.decode(stateJson)
state.totalInFlight = math.max(0, state.totalInFlight - 1)
redis.call('HSET', jobTypesKey, jobTypeId, cjson.encode(state))

-- Decrement instance in-flight for this job type
local instanceKey = instanceJobTypesKey .. ':' .. instanceId
local currentInFlight = tonumber(redis.call('HGET', instanceKey, jobTypeId) or "0")
redis.call('HSET', instanceKey, jobTypeId, math.max(0, currentInFlight - 1))

return 'OK'
`;

/**
 * Set total capacity for job types and recalculate allocated slots.
 * KEYS: [jobTypesKey, channel]
 * ARGV: [totalCapacity]
 * Returns: "OK"
 */
export const SET_JOB_TYPE_CAPACITY_SCRIPT = `
local jobTypesKey = KEYS[1]
local channel = KEYS[2]
local totalCapacity = tonumber(ARGV[1])

local jobTypesData = redis.call('HGETALL', jobTypesKey)

for i = 1, #jobTypesData, 2 do
  local jobTypeId = jobTypesData[i]
  local state = cjson.decode(jobTypesData[i+1])
  state.allocatedSlots = math.floor(totalCapacity * state.currentRatio)
  redis.call('HSET', jobTypesKey, jobTypeId, cjson.encode(state))
end

-- Publish update
redis.call('PUBLISH', channel, cjson.encode({type='capacity', totalCapacity=totalCapacity}))

return 'OK'
`;

/**
 * Get job types stats.
 * KEYS: [jobTypesKey]
 * Returns: JSON with job type stats
 */
export const GET_JOB_TYPES_STATS_SCRIPT = `
local jobTypesKey = KEYS[1]

local jobTypesData = redis.call('HGETALL', jobTypesKey)
local stats = {}

for i = 1, #jobTypesData, 2 do
  local jobTypeId = jobTypesData[i]
  local state = cjson.decode(jobTypesData[i+1])
  stats[jobTypeId] = state
end

return cjson.encode(stats)
`;
