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

Awesome, now, please remove the singular createLLMRateLimiter, by default, only the createMultiModelRateLimiter must exist (all singular rate limiters are also multi model rate limiters, so no problem). Nevertheless, do not call the multimodel like that, just call it "createLLMRateLimiter". With this, I mean that we must prevent the user from creating what currently is a 'createLLMRateLimiter' object, instead, the only object the user can create is the 'createMultiModelRateLimiter' (it must be called 'createLLMRateLimiter'). Remember that you have to update all the tests that currently use the singular 'createLLMRateLimiter' so they use the new signature (meaning, the signature of the 'createMultiModelRateLimiter' which now will also be called 'createLLMRateLimiter')

---

Awesome, thank you.
Question: is the rate limiter being reset after 1 minute and/or 1 day? And, does the queue automatically tries to process pending jobs when the available slots change?

The rate-limiting options for the models include things like 'tokens per minute', this, of course, resets every minute. Nevertheless, the 'tokens per day' should not be affected by the resetting of the 'tokens per minute', meaning that if we have 1000 tpm and 10000 tpd, then, if:
- Req 1 (100 tokens) at second 0: available
- Req 2 (100 tokens) at second 10: available
- Req 3 (800 tokens) at second 20: available
- Req 4 (100 tokens) at second 30: NOT available
- Req 4 must be automatically retried at second 61 (or, if another model is available, then delegated): available
- Req 5 (900 tokens) at second 62: available (at second 60 the tokens per minute were reset)
- Req 6 (1000 tokens) at second 121: available (at second 120 the tpm were reset again, and so on)
- More reqs adding up to 9999 tokens...
- Req n (100 tokens) at second 12000 (still same day): NOT available (even if the tpm is available, the tpd would not, because we reached the 10000 tpd limit -we have used 9999 tokens so far-).
- Req n must be automatically retried at second 86401 (1 day + 1 second) (or, if another model is available, then delegated): available

Please, in a deep and exhaustive way analyze the current code and tell me if the rate-limiter works as described.

---

Awesome, now, please add onAvailableSlotsChange to the rate-limiter. Basically, the rate-limiter is always calculating how many slots are available (meaning, the number of jobs that can be executed), and it would be useful for the users to have access to this value as it changes.
It must be something like this:

```
const rateLimiter = createRateLimiter({
  onAvailableSlotsChange: (availability: Availability, reason: AvailableSlotChangeReason, adjustment?: RelativeAvailabilityAdjustment) => void,
  // Other already existing fields
  ...
});
```

'Availability' type must be something like:
```
interface Availability {
  slots: number;
  tokensPerMinute: number;
  /* all the other resources current availability */
  ...
}
```

'AvailableSlotChangeReason' can be one of 'adjusment', 'tokensMinute', 'tokensDay', 'requestsMinute', 'requestsDay', 'concurrentRequests', 'memory' in that order (meaning that, if both 'tokensMinute' and 'tokensDay' and 'memory' changed, we must provide only 'tokensMinute'). For example, if at some point the reason is 'memory', it must mean that no other thing changed (because it is the last in order). The 'adjustment' reason must be used when we reserved some resources but the final resource count (returned by the job) was different than the reserved one, then, in this case, the final argument ('adjustment') MUST be provided (in all other cases, it must be undefined). The type 'RelativeAvailabilityAdjustment' is exactly like the Availability type, BUT, it is relative. For example, if we reserved 100 tokensPerMinute and the real job used 50, then we return used minus reserved meaning 50 - 100, meaning -50 (minus 50 will inform the user that we have 50 more), on the other hand, if we reserved 50 but used 100, then it would be 100 - 50 meaning 50, which will inform the user 50 more were used. The same must happen for all the other limiters (except memory, which will always be 0 for the adjusment).

Each time the number of slots change (for any reason), this function must trigger. The 'onAvailableSlotsChange' callback must be optional, meaning the user may not provide it.

Please, include tests to check that, when the number of slots must change, that function is actually triggered (and with a correct value). Keep in mind that the slots may change due to memory, tokens, requests, etc.

---

Awesome. Now, this is the current coverage report:
...

Please, add tests so we have 100% coverage on everything, statements, branches, funcs, lines

---

Awesome, thank you. I have a question: how can we extend this system to also be in sync when the user has a distributed system. For example, imagina the user has several instances of the same server (thus, same rate-limiter, but different instances). Turns out the LLM provider has a fixed limit, meaning that the rates do not care about the server that consumes it, those rates are static whether they are reached from 1 or 100 instances. In this case, the user requires a way of synching the current usage across instances (distributed) and our rate limiter must somehow communicate with that logic to know before-hand how many slots are available, BUT, when the rate-limiter uses one of those slots, we distributed system must be aware that one slot less is available, so other instance cannot claim that same slot.

Analyzing our current API design and our implementation, how could we extend it to allow our users to synch their different instances?
Do not implement nothing, just help me plan the best way to do this.

---

Awesome, thanks. I was thinking about creating new properties for the initialization of the 'createLLMRateLimiter' function, the 'acquire' and 'release' callbacks.

Something like:

```
const rateLimiter = createRateLimiter({
  acquire: async (availability: Availability) => boolean,
  release: async (availability: Availability) => void,
  // Other already existing fields
  ...
});
```

This 'acquire' and 'release' callbacks would be optional.
If not provided, everything must work as it currently does. Nevertheless, if they are provided, we must call them before acquiring and releasing resources respectively, and wait for them to resolve. This will allow the user to control resources across different instances. For example, a LLM has a fixed rate, that is shared across all instances, we need to support that. In order to do that, the user will implement custom logic inside the acquire function (maybe a redis lock, or whatever, we don't care) to synchronize the resources across instances. We must do this because we only have local data, meaning we do not know what is happening in other instances. By providing the 'acquire' callback and having to wait for it before (like a lock), we can ensure our local instance is safe to proceed, because whatever logic the user puts inside of it must only resolve when the distributed system "accepts" our request.

Is this the same as any of the options you provided?
What do you think?

---

One thing, let's use property 'backend' in the initialization. Like:
```
const rateLimiter = createRateLimiter({
  backend: {
    acquire: ...,
    release: ...,
  },
  // Other already existing fields
  ...
});
```

---

Wait, I thought about another thing: how will an instance know how many available slots it has? The instance does not know, the distributed system knows. If instance A and B calculate slots locally, both could have the same number, but, in reality, the real slots are going to be fewer (ofc, unless memory is limiting mainly). Instances must know the slots so the users can limit the rate at which they feed jobs to each instance's queue. What do you think?

---

For testing, please include some tests that create several rate-limiters (with same limites, but a distributed back-end), so we can check they work properly when there are several instances.
Please, create dummy back-end that help us test the acquire/release methods, BUT also that the pub/sub event the user can trigger to inform that the availability changed in the distributed system is working, meaning that the rate-limiters are updated.

Finally, let's please implement a load test. This test must create several rate-limiters with a dummy but complete back-end (it must change the availability with the pub/sub), etc., and hundreds/thousands of jobs. The test must check that no individual instance exceeds the limits, BUT it must also check that in total, the limit is never excedeed in addition across instances, even under high loads. This test must exceed the total tokens per minute, so we check that, after 1 minute passes, the instances retry the jobs. Since this test will probably be big, please create several test files and utils for it, so our code is organized.

---

Great, now, question:
Imagine this scenario:
- There are 0 jobs, this is the very first time the rate-limiter will be used.
- The rate-limiter has a maximum of 100 concurrent requests (let's assume that's the bottleneck)

Then:
- Instance A initiates rate-limiter: gets 100 slots
- Instance B initiates rate-limiter: gets 100 slots

As soon as either A or B calls the acquire method, the implemented back-end should trigger an event that will inform the other instances the availability changed, so:
- Instance A acquires, then: instance A gets 99 slots, triggers event, instance B receives event, now availability for B is 99 slots.

Is this right? Is this how it would actually work? 

---

Thank you. If that's the case, we have an issue. Turns out that the idea of the 'slots' is to inform the instance how many jobs such instance can process. For the example I provided earlier, in theory both instance A and B could process 100 jobs, BUT, if instance A processes 100 jobs, then instance B should not be able to process any. The issue is that, in a distributed system, where the jobs are fetched from, let's say, an external message queue, having both A and B thinking they have 100 slots each, would imply that A fetches 100 jobs from the queue and B too, meaning 200 jobs in total, which would be twice the capacity. 

---

Besides this:
1. Instance A starts → local config says 100 → A fetches 100 jobs
2. Instance B starts → local config says 100 → B fetches 100 jobs
3. 200 jobs fetched, only 100 can be processed      
4. Backend.acquire() rejects 100 of them (too late, already fetched)

This is also an issue:
1. Instance A starts, subscribes to backend
2. Backend tells A: "100 slots available globally"
3. A's onAvailableSlotsChange(100) fires → A fetches 100 jobs from queue
4. Instance B starts, subscribes to backend
5. Backend tells B: "0 slots available globally" (A has them all)
6. B's onAvailableSlotsChange(0) fires → B fetches 0 jobs from queue

That is an issue because, in a distributed system, we would expect the load to be distributed evenly across all instances. In our example, the proper flow would be that, at the beginning, A gets all slots (minimum of distributed slots and local slots), but, as soon as B starts the rate-limiter, the available slots (the availability data stored in the distributed system) should be evenly assigned between A and B, meaning that if A had 50 and there were other 50 available, then B should get those 50, but, if there were only 60 available and A had 50, then B should get 30 and A should shrink to 30. Nevertheless, since A could possibly be already processing 50, we should decrease it gradually, and, in the same way, we should increase B gradually.

In general, we should always divide the total slots evenly in the number of instances connected to our distributed back-end. Nevertheless, since not all back-ends connect at the same time (auto-scale groups, crashed, etc.), we must nivelate the load (availability) of each instance, but this leveling must be gradual, because there could be already running jobs that we do not want to block/stale, and also, we cannot under any circumpstance exceed the total capacity of the external resource (llm).

---

