require('dotenv').config();
const OpenAI = require('openai');
const { log } = require('./logger');

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': process.env.SITE_URL || 'https://github.com/instagram-outreach-agent',
    'X-Title': 'Instagram Outreach Agent',
  },
});

const MODEL = process.env.LLM_MODEL || 'openrouter/owl-alpha';

const BASE_PROMPT = `Eres un emprendedor que quiere conectar genuinamente con otros emprendedores en Instagram.
Escribe un DM corto (3-4 líneas) basado en la bio de esta persona: "{bio}".
El mensaje debe sonar humano y natural, mencionar algo específico de su bio,
y terminar con una pregunta abierta. Sin emojis excesivos. En español.`;

async function generateDM(bio) {
  const prompt = BASE_PROMPT.replace('{bio}', bio || 'emprendedor en Instagram');
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.85,
    max_tokens: 200,
  });
  const text = response.choices[0].message.content.trim();
  log(`[llm] Generated ${text.length} chars via ${MODEL}`);
  return text;
}

module.exports = { generateDM };
