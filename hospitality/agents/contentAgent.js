// ─── Content Agent ─────────────────────────────────────────────
// Generates social media content for AI influencer personas.
// Handles: content planning, script generation, caption writing,
// hashtag optimization, and scheduling decisions.

const https = require('https');
const { getPersona } = require('../persona/personaManager');
const { createTrace, TRACE_TYPES } = require('../engine/attribution');
const { v4: uuidv4 } = require('uuid');

// ─── CONTENT TYPES ──────────────────────────────────────────────

const CONTENT_TYPES = {
  ROOM_TOUR: 'room_tour',
  FOOD_SPOTLIGHT: 'food_spotlight',
  LOCAL_TIPS: 'local_tips',
  BEHIND_THE_SCENES: 'behind_the_scenes',
  GUEST_STORIES: 'guest_stories',
  PROMOTIONS: 'promotions',
  QA: 'qa',
  SEASONAL: 'seasonal',
  EVENT: 'event'
};

const PLATFORMS = {
  INSTAGRAM_POST: 'instagram_post',
  INSTAGRAM_REEL: 'instagram_reel',
  INSTAGRAM_STORY: 'instagram_story',
  TIKTOK: 'tiktok',
  YOUTUBE_SHORT: 'youtube_short',
  FACEBOOK: 'facebook',
  LINKEDIN: 'linkedin'
};

// ─── CONTENT PLANNER ────────────────────────────────────────────
// Decides what content to create based on the persona's strategy
// and recent performance data.

function planContent(persona, { recentPerformance = {}, upcomingEvents = [], season = null } = {}) {
  const strategy = persona.contentStrategy;
  const mix = strategy.contentMix;

  // Weight content types by configured mix percentage + performance boost
  const weighted = Object.entries(mix).map(([type, weight]) => {
    const perfBoost = recentPerformance[type]?.engagementRate > 5 ? 10 : 0;
    return { type, weight: weight + perfBoost };
  });

  // Sort by weight, pick top
  weighted.sort((a, b) => b.weight - a.weight);

  // Generate a week's content plan
  const postsPerDay = strategy.postingFrequency === '2x-daily' ? 2
    : strategy.postingFrequency === '3x-weekly' ? 0.43
    : 1;

  const plan = [];
  const daysToplan = 7;
  let contentIndex = 0;

  for (let day = 0; day < daysToplan; day++) {
    const postsToday = Math.round(postsPerDay);
    for (let p = 0; p < postsToday; p++) {
      const contentType = weighted[contentIndex % weighted.length].type;
      const platform = selectPlatform(contentType, persona.platforms);
      const postTime = strategy.bestPostingTimes[p % strategy.bestPostingTimes.length];

      plan.push({
        id: uuidv4(),
        day: day + 1,
        contentType: mapMixKeyToContentType(contentType),
        platform,
        scheduledTime: postTime,
        status: 'planned',
        personaId: persona.id,
        hotelId: persona.hotelId
      });

      contentIndex++;
    }
  }

  // Inject event-based content if any
  for (const event of upcomingEvents) {
    plan.push({
      id: uuidv4(),
      day: 1,
      contentType: CONTENT_TYPES.EVENT,
      platform: PLATFORMS.INSTAGRAM_POST,
      scheduledTime: '10:00',
      status: 'planned',
      personaId: persona.id,
      hotelId: persona.hotelId,
      eventContext: event
    });
  }

  return plan;
}

function mapMixKeyToContentType(key) {
  const map = {
    roomTour: CONTENT_TYPES.ROOM_TOUR,
    foodSpotlight: CONTENT_TYPES.FOOD_SPOTLIGHT,
    localTips: CONTENT_TYPES.LOCAL_TIPS,
    behindTheScenes: CONTENT_TYPES.BEHIND_THE_SCENES,
    guestStories: CONTENT_TYPES.GUEST_STORIES,
    promotions: CONTENT_TYPES.PROMOTIONS,
    qa: CONTENT_TYPES.QA
  };
  return map[key] || CONTENT_TYPES.LOCAL_TIPS;
}

function selectPlatform(contentType, availablePlatforms) {
  // Content-type to ideal platform mapping
  const idealMap = {
    roomTour: 'instagram_reel',
    foodSpotlight: 'instagram_post',
    localTips: 'instagram_story',
    behindTheScenes: 'tiktok',
    guestStories: 'instagram_post',
    promotions: 'instagram_story',
    qa: 'instagram_story'
  };

  const ideal = idealMap[contentType] || 'instagram_post';

  // Check if the platform is available for this persona
  if (availablePlatforms.includes('instagram') && ideal.startsWith('instagram')) return ideal;
  if (availablePlatforms.includes('tiktok') && ideal === 'tiktok') return ideal;

  // Fallback to first available
  return `${availablePlatforms[0]}_post`;
}

// ─── CONTENT GENERATOR ──────────────────────────────────────────
// Uses Claude to generate captions, scripts, and hashtags.

async function generateContent({ personaId, contentType, platform, context = {} }) {
  const persona = getPersona(personaId);
  if (!persona) throw new Error('Persona not found');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const isVideo = [PLATFORMS.INSTAGRAM_REEL, PLATFORMS.TIKTOK, PLATFORMS.YOUTUBE_SHORT].includes(platform);
  const isStory = platform === PLATFORMS.INSTAGRAM_STORY;

  let prompt;
  if (isVideo) {
    prompt = buildVideoScriptPrompt(persona, contentType, context);
  } else if (isStory) {
    prompt = buildStoryPrompt(persona, contentType, context);
  } else {
    prompt = buildPostPrompt(persona, contentType, context);
  }

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: `You are a social media content creator for ${persona.name}, a ${persona.role} at a luxury hotel.
Personality: ${persona.personality.tone}. Traits: ${persona.personality.traits.join(', ')}.
Languages: ${persona.languages.join(', ')}.
Never mention: ${persona.personality.guardrails.avoid.join(', ')}.
Output ONLY the requested content format. No explanations.`,
    messages: [{ role: 'user', content: prompt }]
  });

  const response = await callAPI(apiKey, body);

  // Parse the structured response
  const content = parseContentResponse(response, isVideo, isStory);

  // Generate image prompt for visual consistency
  const { buildImagePrompt } = require('../persona/personaManager');
  const imagePrompt = buildImagePrompt(persona, getSceneForContentType(contentType));

  // Create attribution trace
  createTrace({
    type: TRACE_TYPES.IMPRESSION,
    guestId: null,
    personaId,
    hotelId: persona.hotelId,
    channel: platform,
    data: { contentType, contentId: uuidv4() }
  });

  return {
    id: uuidv4(),
    personaId,
    contentType,
    platform,
    ...content,
    imagePrompt,
    status: 'draft', // needs HITL approval before publishing
    createdAt: new Date().toISOString()
  };
}

function buildPostPrompt(persona, contentType, context) {
  const hashtags = persona.contentStrategy.hashtags.join(' ');
  return `Create an Instagram post for a ${contentType.replace(/_/g, ' ')} at our hotel.
${context.details ? `Context: ${context.details}` : ''}
${context.season ? `Season: ${context.season}` : ''}

Output in this exact JSON format:
{
  "caption": "The Instagram caption (max 300 chars, engaging, with emojis)",
  "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "imageDescription": "Description of the ideal photo to accompany this post",
  "callToAction": "The CTA text (e.g. 'Link in bio', 'DM me for details')",
  "altText": "Accessibility alt text for the image"
}

Brand hashtags to include: ${hashtags}`;
}

function buildVideoScriptPrompt(persona, contentType, context) {
  return `Create a short video script (15-30 seconds) for a ${contentType.replace(/_/g, ' ')} reel/TikTok.
${context.details ? `Context: ${context.details}` : ''}

Output in this exact JSON format:
{
  "hook": "Opening line to grab attention (first 3 seconds)",
  "script": "Full narration script with timing cues",
  "scenes": ["Scene 1 description", "Scene 2 description", "Scene 3 description"],
  "caption": "Post caption (max 200 chars)",
  "hashtags": ["tag1", "tag2", "tag3"],
  "music": "Suggested music mood/style",
  "duration": "estimated seconds"
}`;
}

function buildStoryPrompt(persona, contentType, context) {
  return `Create an Instagram Story slide for a ${contentType.replace(/_/g, ' ')}.
${context.details ? `Context: ${context.details}` : ''}

Output in this exact JSON format:
{
  "text": "Main story text (short, punchy)",
  "sticker": "Suggested interactive sticker (poll, quiz, slider, countdown)",
  "stickerContent": "The sticker question/options",
  "background": "Description of the background image/video",
  "cta": "Swipe up CTA or link sticker text"
}`;
}

function getSceneForContentType(contentType) {
  const sceneMap = {
    [CONTENT_TYPES.ROOM_TOUR]: 'luxury hotel suite, elegant interior',
    [CONTENT_TYPES.FOOD_SPOTLIGHT]: 'gourmet restaurant, plated dish',
    [CONTENT_TYPES.LOCAL_TIPS]: 'scenic outdoor location, tourist attraction',
    [CONTENT_TYPES.BEHIND_THE_SCENES]: 'hotel kitchen or concierge desk',
    [CONTENT_TYPES.GUEST_STORIES]: 'hotel lobby, warm lighting',
    [CONTENT_TYPES.PROMOTIONS]: 'hotel pool area, luxury setting',
    [CONTENT_TYPES.QA]: 'casual portrait, hotel garden'
  };
  return sceneMap[contentType] || 'hotel lobby portrait';
}

function parseContentResponse(raw, isVideo, isStory) {
  try {
    // Try to extract JSON from the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // Fallback: return raw text as caption
  }
  return { caption: raw, hashtags: [], imageDescription: '' };
}

async function callAPI(apiKey, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, 'utf8');
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': buf.length
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode !== 200) return reject(new Error(data?.error?.message || 'API error'));
          resolve(data.content[0]?.text || '');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(buf);
    req.end();
  });
}

// ─── CONTENT QUEUE ──────────────────────────────────────────────
// In-memory queue for content awaiting approval (HITL)

const contentQueue = [];

function addToQueue(content) {
  content.queuedAt = new Date().toISOString();
  content.status = 'pending_review';
  contentQueue.push(content);
  return content;
}

function getQueue(personaId = null) {
  if (personaId) return contentQueue.filter(c => c.personaId === personaId);
  return [...contentQueue];
}

function approveContent(contentId) {
  const item = contentQueue.find(c => c.id === contentId);
  if (!item) throw new Error('Content not found in queue');
  item.status = 'approved';
  item.approvedAt = new Date().toISOString();
  return item;
}

function rejectContent(contentId, reason) {
  const item = contentQueue.find(c => c.id === contentId);
  if (!item) throw new Error('Content not found in queue');
  item.status = 'rejected';
  item.rejectedAt = new Date().toISOString();
  item.rejectionReason = reason;
  return item;
}

module.exports = {
  CONTENT_TYPES,
  PLATFORMS,
  planContent,
  generateContent,
  addToQueue,
  getQueue,
  approveContent,
  rejectContent
};
