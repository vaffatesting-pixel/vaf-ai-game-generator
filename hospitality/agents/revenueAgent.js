// ─── Revenue Intelligence Agent ────────────────────────────────
// Multi-agent crew for revenue optimization.
// Agents: Market Analyst, Demand Forecaster, Social Analyst, Pricing Strategist.
// Inspired by CrewAI pattern but implemented natively.

const https = require('https');
const { getHotelFunnel, getPersonaPerformance } = require('../engine/attribution');

// ─── AGENT DEFINITIONS ──────────────────────────────────────────

const AGENTS = {
  marketAnalyst: {
    name: 'Market Analyst',
    role: 'Analyze competitor pricing and market positioning',
    systemPrompt: `You are a hotel revenue analyst. Analyze the provided market data and competitor pricing.
Output a JSON report with:
{
  "marketPosition": "premium/mid-range/budget relative to competitors",
  "competitorAvgPrice": number,
  "priceGap": "percentage above or below market average",
  "opportunities": ["list of pricing opportunities"],
  "threats": ["list of competitive threats"],
  "recommendation": "brief pricing recommendation"
}`
  },

  demandForecaster: {
    name: 'Demand Forecaster',
    role: 'Predict occupancy and demand trends',
    systemPrompt: `You are a demand forecasting specialist for hotels. Based on historical occupancy data and upcoming events, predict demand.
Output a JSON report with:
{
  "predictedOccupancy": { "next7days": number, "next30days": number },
  "demandTrend": "increasing/stable/decreasing",
  "peakDates": ["YYYY-MM-DD dates with expected high demand"],
  "lowDates": ["YYYY-MM-DD dates with expected low demand"],
  "events": ["local events affecting demand"],
  "confidence": "high/medium/low"
}`
  },

  socialAnalyst: {
    name: 'Social Sentiment Analyst',
    role: 'Analyze social media engagement and sentiment',
    systemPrompt: `You are a social media analytics specialist for hospitality. Analyze the engagement metrics and sentiment data.
Output a JSON report with:
{
  "overallSentiment": "positive/neutral/negative",
  "engagementTrend": "growing/stable/declining",
  "topPerformingContent": ["content types that perform best"],
  "audienceInsights": ["key audience behavior patterns"],
  "viralPotential": "high/medium/low",
  "recommendedContentFocus": "what content to create more of"
}`
  },

  pricingStrategist: {
    name: 'Pricing Strategist',
    role: 'Synthesize all analyses into actionable pricing recommendations',
    systemPrompt: `You are a hotel pricing strategist. Based on market analysis, demand forecast, and social sentiment data, provide pricing recommendations.
Output a JSON report with:
{
  "overallStrategy": "description of recommended pricing strategy",
  "rateAdjustments": [
    { "roomType": "type", "currentRate": number, "recommendedRate": number, "reason": "why" }
  ],
  "promotions": [
    { "type": "flash_sale/package/early_bird", "description": "details", "targetAudience": "who", "channel": "where" }
  ],
  "campaignTriggers": [
    { "condition": "what triggers", "action": "what to do", "urgency": "high/medium/low" }
  ],
  "projectedRevenueImpact": "estimated percentage change"
}`
  }
};

// ─── CREW ORCHESTRATOR ──────────────────────────────────────────

async function runRevenueCrew({ hotelId, historicalData = {}, competitorData = {}, socialMetrics = {} }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const startTime = Date.now();
  const results = {};

  // Get attribution data
  const funnel = getHotelFunnel(hotelId);
  const personaPerf = getPersonaPerformance(hotelId);

  // Step 1: Run Market Analyst and Demand Forecaster in parallel
  const [marketReport, demandReport] = await Promise.all([
    runAgent(apiKey, AGENTS.marketAnalyst, {
      hotelId,
      competitors: competitorData,
      currentPricing: historicalData.currentPricing || {}
    }),
    runAgent(apiKey, AGENTS.demandForecaster, {
      hotelId,
      historicalOccupancy: historicalData.occupancy || {},
      upcomingEvents: historicalData.events || [],
      currentDate: new Date().toISOString().split('T')[0]
    })
  ]);

  results.marketAnalysis = marketReport;
  results.demandForecast = demandReport;

  // Step 2: Run Social Analyst (can also be parallel with step 1)
  const socialReport = await runAgent(apiKey, AGENTS.socialAnalyst, {
    hotelId,
    socialMetrics,
    personaPerformance: personaPerf,
    funnelData: funnel
  });
  results.socialAnalysis = socialReport;

  // Step 3: Run Pricing Strategist with all inputs
  const pricingReport = await runAgent(apiKey, AGENTS.pricingStrategist, {
    hotelId,
    marketAnalysis: results.marketAnalysis,
    demandForecast: results.demandForecast,
    socialAnalysis: results.socialAnalysis,
    funnelConversionRate: funnel.conversionRate,
    totalAttributedRevenue: funnel.totalRevenue
  });
  results.pricingStrategy = pricingReport;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  return {
    hotelId,
    timestamp: new Date().toISOString(),
    executionTimeSeconds: parseFloat(elapsed),
    agentsRun: Object.keys(AGENTS).length,
    results,
    // Extract action items for the dashboard
    actionItems: extractActionItems(results)
  };
}

async function runAgent(apiKey, agent, data) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: agent.systemPrompt,
    messages: [{
      role: 'user',
      content: `Analyze the following data for hotel revenue optimization:\n\n${JSON.stringify(data, null, 2)}`
    }]
  });

  const response = await callAPI(apiKey, body);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    // Return raw response wrapped
  }
  return { raw: response };
}

function extractActionItems(results) {
  const items = [];

  // From pricing strategy
  if (results.pricingStrategy?.rateAdjustments) {
    for (const adj of results.pricingStrategy.rateAdjustments) {
      items.push({
        type: 'rate_adjustment',
        priority: 'high',
        description: `Adjust ${adj.roomType}: €${adj.currentRate} → €${adj.recommendedRate}`,
        reason: adj.reason
      });
    }
  }

  // From promotions
  if (results.pricingStrategy?.promotions) {
    for (const promo of results.pricingStrategy.promotions) {
      items.push({
        type: 'campaign',
        priority: 'medium',
        description: promo.description,
        channel: promo.channel,
        targetAudience: promo.targetAudience
      });
    }
  }

  // From campaign triggers
  if (results.pricingStrategy?.campaignTriggers) {
    for (const trigger of results.pricingStrategy.campaignTriggers) {
      items.push({
        type: 'trigger',
        priority: trigger.urgency,
        description: `When: ${trigger.condition} → ${trigger.action}`
      });
    }
  }

  return items;
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
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Revenue agent timeout')); });
    req.write(buf);
    req.end();
  });
}

module.exports = { runRevenueCrew, AGENTS };
