Awesome, now, we must implement a "llm model identification". 

Basically, the properties 'requestsPerMinute', 'requestsPerDay', 'tokensPerMinute', 'tokensPerDay' and 'maxConcurrentRequests' must be defined on a "llm model level".

In production systems, it is normal to use several models, for example grok, chatgpt, sonnet, all together, instead of just one.
The thing is, each model have its own rate limiting. Therefore, we must be able to define those limites PER model. Then, each model must internally create its own independent rate-limiter.

In order to achieve this, the user must provide a unique identifier for each model, alongside its limits.

Now, if there is more than one model, and one of them is out of resources, we must automatically fallback to the next available model (which must have its independent rate-limiter).

Therefore, the user must also be able to define the order of usage, for example with something like this:
['grok-4.1', 'chatgpt-3.5', 'gemini-2.0']
This would mean we are always going to try to use 'grok-4.1' first, and only if the rate-limiting of that is reached, we would fallback to 'chatgpt-3.5' and so on.

Now, this must provide compile-time type safety, meaning that if a user has not defined limits for 'grok-4.1', for example, then he cannot use 'grok-4.1' in the order array. Also, if the user only defines one model, then the order array must not be required, but if there's more than one model defined (limits), then the order array must be required.

---

Awesome, now, we must give the user the ability to mark a job as failed so the rate-limiter can automatically try to assign the job to the next model (if one is available).

For example, when the user adds a job:
```
rateLimiter.queueJob(job, args)
```

We must ensure such job has a signature somewhat like this:
```type job = (args: JobArgs, resolve: () => void, reject: (args: {delegate: boolean} = {delegate: true}) => void) => Promise<T> | T```

Then, when in the rate limiter we call such job, we must do something like:
```
let delegateToNextModel = undefined;
if (isNextModelAvailable()) {
  delegateToNextModel = async () => {
    const nextModel = getNextModel();
    nextModel.queueJob(job, args);
  }
}

const resolve = () => {
  // Free resources for the used model HERE
};

const reject = (args: {delegate: boolean}) => {
  // Free resources for the used model HERE
  const { delegate } = args;
  if (delegate && delegateToNextModel !== undefined) delegateToNextModel();
};

callback(args, resolve, reject);
```

So the job the user defines must be something like this:
```
const myJob = (args: SomeArgs, resolve: () => void, reject: (args: {delegate: boolean}) => void) => {
  try {
    ...
    resolve();
  } catch (e) {
    ...
    reject();
  }
}
```

Let's update the signature for the queueJob function. Currently it is something like:
```rateLimiter.queueJob(job, args)```

Now, we must do something like:
```
rateLimiter.queueJob({
  jobId: 'unique string',
  job: () => { ... },
  args: ...,
  onComplete: () => { ... }, // this must be called when the job resolves, no matter from which model
  onError: () => { ... } // this must be called when the job rejects AND the user decided not to delegate, or the was not any available model for delegation
})
```

---

Now, for the queueJob function, both the onComplete and onError callbacks must receive a 'usage' array.
It must be something like this:

type Usage = Array<{
  modelId: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}>

Each entry of the array belongs to each model used. For example, if model A failed, it does not mean we did not use tokens from A, therefore, if we fallback to model B and it works, then when the job resolves, we will have usage for both models. The same can happen even if all models rejects. Rejecting does not mean the model was not used. If the model A did not have capacity and we automatically default to model B, then model A was not used at all, and it should not have an entry in the Usage array. Nevertheless, if the user decided that model A failed by calling the reject callback, then it is possible there was usage from model A.

In order to support this, besides modifying the signatures of onComplete and onError handlers, we must also ensure that the resolve and reject handlers of the job both require a Usage element (element, not array).

Now, for traceability purposes, the onComplete and onError handlers must also receive the jobId. So, in general, it must be something like this:

```
rateLimiter.queueJob({
  jobId: 'unique string',
  job: () => { ... },
  args: ...,
  onComplete: ({jobId, usage}: {jobId: string, usage: Usage /* Usage is an array */}) => {
    ...
  },
  onError: sameAsOnComplete
})
```

---

Now, please, we need to add costs calculation. For this, extend the ModelRateLimitConfig interface so besides the old fields, the user must define the prices, for example:

export interface ModelRateLimitConfig {
  /** All previous fields */
  ...

  /** New property for costs calcution - ALWAYS in USD, and per million tokens */
  pricing: {
    input: number;
    cached: number;
    output: number;
  }
}

Then, when a job reaches the onComplete or onError handler, we must include cost calculations, this must be inside each element of the Usage array. So the new signature is:

```
type Usage = Array<{
  modelId: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  cost: number; // This must be calculated
}>
```

Finally, also include a totalCost argument to the signature, so onComplete and onError look like this:

```
rateLimiter.queueJob({
  jobId: 'unique string',
  job: () => { ... },
  args: ...,
  onComplete: ({jobId, totalCost, usage}: {jobId: string, totalCost: number, usage: Usage }) => {
    ...
  },
  onError: sameAsOnComplete
})
```

---

Awesome, now, please include tests to verify that the model scalation works for these cases:
- The job decided to delegate
- The n model ran out of resources, so the n+1 model was automatically called (include tests for several levels of n, not just 1 and 2)
- The resources are freed ONLY after the job resolved or rejected
- The resources are freed ONLY for the model the model that resolved or rejected
- When models are exhausted, the onError callback is called with proper arguments (usage and jobId)
- When a job resolves, the onComplete callback is called with proper arguments (usage and jobId)
- When a model does not have capacity and the next model is called, if it resolves, the onComplete callback is called with proper arguments (usage for only the second model and jobId)
- When a model does not have capacity and the next model is called, if it rejects and there is no next model, the onError callback is called with proper arguments (usage for only the second model and jobId)
- Some tests to ensure the price calculation is correct

---

Awesome, now, please add onAvailableSlotsChange to the rate-limiter.
