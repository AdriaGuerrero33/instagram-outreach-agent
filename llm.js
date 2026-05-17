require('dotenv').config();
const OpenAI = require('openai');
const { log } = require('./logger');
const { load: loadConfig } = require('./config');

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': process.env.SITE_URL || 'https://github.com/instagram-outreach-agent',
    'X-Title': 'Instagram Outreach Agent',
  },
});

const MODEL = process.env.LLM_MODEL || 'openrouter/owl-alpha';

async function generateDM(bio) {
  const cfg = loadConfig();
  const prompt = cfg.dmPrompt.replace('{bio}', bio || 'emprendedor en Instagram');
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
