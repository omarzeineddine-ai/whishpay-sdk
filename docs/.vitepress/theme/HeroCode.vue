<template>
  <div class="hero-code" aria-label="Example: create a payment and verify the callback">
    <div class="hero-code-bar">
      <span class="dot" /><span class="dot" /><span class="dot" />
      <span class="file">checkout.ts</span>
    </div>
    <pre><code><span class="k">const</span> { collectUrl } = <span class="k">await</span> whish.payments.<span class="f">create</span>({
  amount: <span class="s">'25.00'</span>,
  currency: <span class="s">'USD'</span>,
  externalId,
  successCallbackUrl,
  failureCallbackUrl,
  successRedirectUrl,
  failureRedirectUrl,
});

<span class="c">// later, in your callback route</span>
<span class="k">const</span> result = <span class="k">await</span> whish.callbacks.<span class="f">verify</span>(
  request,
  { lookup },
);

<span class="k">if</span> (result.found &amp;&amp; result.status === <span class="s">'success'</span>) {
  <span class="k">await</span> <span class="f">markPaid</span>(result.order);
}</code></pre>
  </div>
</template>
