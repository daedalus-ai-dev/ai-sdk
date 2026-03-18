# Example: Customer Support Router

**Pattern:** [Routing](../patterns/routing)

A multilingual customer support system that classifies incoming messages by language, intent, and urgency, then routes each to the right specialist agent — escalating critical cases to a human queue.

```
Message → Classifier → [language router] → Specialist Agent → Reply
                     → [urgency check]  → Human escalation
```

## Full example

```ts
import { agent } from '@daedalus-ai-dev/ai-sdk';
import { anthropic } from '@daedalus-ai-dev/ai-sdk';
import { openai } from '@daedalus-ai-dev/ai-sdk';

type Classification = {
  language: 'en' | 'es' | 'de' | 'fr' | 'other';
  intent: 'billing' | 'technical' | 'returns' | 'general';
  urgency: 'low' | 'medium' | 'high';
  summary: string;
};

type SupportResponse = {
  reply: string;
  escalated: boolean;
  escalationReason?: string;
  language: string;
  intent: string;
};

// ─── Specialist agents ────────────────────────────────────────────────────────

const billingAgent = agent({
  provider: anthropic('claude-opus-4-6'),
  instructions: `You are a billing support specialist.
- Always acknowledge the customer's frustration if present
- Reference the 30-day return policy for refund requests
- For disputes, offer to review within 2 business days
- Never promise refunds without checking eligibility criteria`,
});

const technicalAgent = agent({
  provider: anthropic('claude-opus-4-6'),
  instructions: `You are a technical support engineer.
- Ask for the specific error message and steps to reproduce
- Provide numbered, step-by-step solutions
- Offer a follow-up ticket if the issue isn't resolved in one exchange
- Escalate unknown bugs to the engineering team`,
});

const returnsAgent = agent({
  provider: openai('gpt-4o'),
  instructions: `You are a returns and exchanges specialist.
- Verify the 30-day window from purchase date
- Walk through the return shipping label process
- Offer store credit as an alternative to a refund`,
});

const generalAgent = agent({
  provider: openai('gpt-4o-mini'),
  instructions: 'You are a friendly customer service agent. Be helpful, concise, and warm.',
});

// ─── Translation helpers ──────────────────────────────────────────────────────

async function translateToEnglish(text: string, fromLanguage: string): Promise<string> {
  const r = await agent({
    provider: openai('gpt-4o-mini'),
    instructions: 'Translate accurately. Return only the translated text, nothing else.',
  }).prompt(`Translate from ${fromLanguage} to English:\n\n${text}`);
  return r.text;
}

async function translateFromEnglish(text: string, toLanguage: string): Promise<string> {
  const r = await agent({
    provider: openai('gpt-4o-mini'),
    instructions: 'Translate accurately, preserving tone. Return only the translated text.',
  }).prompt(`Translate from English to ${toLanguage}:\n\n${text}`);
  return r.text;
}

// ─── Human escalation queue (replace with your ticketing system) ──────────────

async function escalateToHuman(message: string, reason: string, classification: Classification) {
  console.log(`[ESCALATION] Reason: ${reason}`);
  console.log(`[ESCALATION] Intent: ${classification.intent}, Language: ${classification.language}`);
  // e.g. await zendesk.createTicket({ body: message, priority: 'urgent', tags: [...] });
}

// ─── Main router ──────────────────────────────────────────────────────────────

async function handleSupportMessage(message: string): Promise<SupportResponse> {
  // Step 1: Classify with a cheap, fast model
  const classification = await agent({
    provider: openai('gpt-4o-mini'),
    instructions: 'Classify customer support messages. Be precise. Return JSON only.',
    schema: (s) => ({
      language: s.enum(['en', 'es', 'de', 'fr', 'other'])
        .description('Detected language of the message').required(),
      intent: s.enum(['billing', 'technical', 'returns', 'general'])
        .description('Primary intent of the message').required(),
      urgency: s.enum(['low', 'medium', 'high'])
        .description('Urgency: high = account locked, data loss, payment failed').required(),
      summary: s.string()
        .description('One sentence English summary of the customer issue').required(),
    }),
  }).prompt<Classification>(`Classify this customer message:\n\n"${message}"`);

  const { language, intent, urgency, summary } = classification.structured;

  // Step 2: Escalate high-urgency billing/technical issues immediately
  if (urgency === 'high' && (intent === 'billing' || intent === 'technical')) {
    await escalateToHuman(message, `High-urgency ${intent} issue: ${summary}`, classification.structured);
    return {
      reply: language !== 'en'
        ? await translateFromEnglish(
            "I've flagged your message as urgent and a specialist will contact you within 1 hour.",
            language
          )
        : "I've flagged your message as urgent and a specialist will contact you within 1 hour.",
      escalated: true,
      escalationReason: `High-urgency ${intent}: ${summary}`,
      language,
      intent,
    };
  }

  // Step 3: Translate non-English messages to English for the specialist
  const englishMessage = language !== 'en'
    ? await translateToEnglish(message, language)
    : message;

  // Step 4: Route to the right specialist
  const specialist = { billing: billingAgent, technical: technicalAgent, returns: returnsAgent }[intent]
    ?? generalAgent;

  const response = await specialist.prompt(englishMessage);

  // Step 5: Translate the reply back to the customer's language
  const reply = language !== 'en'
    ? await translateFromEnglish(response.text, language)
    : response.text;

  return { reply, escalated: false, language, intent };
}

// ─── Usage ────────────────────────────────────────────────────────────────────

const result = await handleSupportMessage(
  'Hola, intento cancelar mi suscripción pero la página sigue cargando. Llevo dos días intentándolo y no puedo.'
);

console.log(`[${result.language.toUpperCase()} / ${result.intent}${result.escalated ? ' / ESCALATED' : ''}]`);
console.log(result.reply);
```

## Why this structure works

- **Cheap classifier first.** `gpt-4o-mini` classifies for a fraction of a cent, saving the expensive specialist call for actual responses.
- **Structured classification.** The schema prevents hallucinated category names and makes routing logic deterministic.
- **Translation layer.** Non-English customers are handled natively in their language — the specialist always works in English for consistency.
- **Explicit escalation path.** High-urgency issues bypass the LLM entirely and go straight to a human queue.

## Extending this example

**Add a sentiment gate** — escalate angry customers regardless of urgency:

```ts
schema: (s) => ({
  ...existingFields,
  sentiment: s.enum(['positive', 'neutral', 'frustrated', 'angry']).required(),
}),

// In routing logic:
if (result.sentiment === 'angry') {
  await escalateToHuman(message, 'Angry customer', classification);
}
```

**Track routing metrics:**

```ts
console.log({
  intent,
  language,
  urgency,
  escalated: result.escalated,
  inputTokens: classification.usage.inputTokens,
});
```
