/**
 * S5.6.H — Historical Replay Routes
 * ==================================
 * 
 * API endpoints for historical replay execution.
 * All operations are READ-ONLY and isolated from production.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replayService, ReplayTweet } from './replay.service.js';

export async function registerReplayRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/v5/replay/session
   * Create a new replay session
   */
  app.post('/api/v5/replay/session', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      asset: 'BTC' | 'ETH' | 'SOL';
      fromHours?: number;
      toHours?: number;
      tweetLimit?: number;
    };
    
    if (!body.asset) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'asset is required',
      });
    }
    
    try {
      const session = await replayService.createSession({
        asset: body.asset,
        fromHours: body.fromHours || 48,
        toHours: body.toHours || 6,
        tweetLimit: body.tweetLimit || 50,
      });
      
      return reply.send({
        ok: true,
        data: {
          session_id: session.session_id,
          asset: session.asset,
          timeRange: session.timeRange,
          mode: session.mode,
          status: session.status,
          message: 'Session created. Now POST tweets to /api/v5/replay/session/:id/tweets',
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'SESSION_CREATE_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v5/replay/session/:id/tweets
   * Process tweets for a replay session
   * 
   * CRITICAL: Each tweet MUST have created_at (t0 = tweet time)
   */
  app.post('/api/v5/replay/session/:id/tweets', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { tweets: ReplayTweet[] };
    
    if (!body.tweets || !Array.isArray(body.tweets) || body.tweets.length === 0) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'tweets array is required',
      });
    }
    
    // Validate tweets have created_at
    for (const tweet of body.tweets) {
      if (!tweet.created_at) {
        return reply.status(400).send({
          ok: false,
          error: 'MISSING_CREATED_AT',
          message: `Tweet ${tweet.tweet_id} missing created_at. t0 MUST be tweet time, not now.`,
        });
      }
    }
    
    try {
      const result = await replayService.processTweets(id, body.tweets);
      
      return reply.send({
        ok: true,
        data: {
          session_id: id,
          processed: result.processed,
          errors: result.errors,
          message: `Processed ${result.processed} tweets with historical prices`,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'PROCESS_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v5/replay/session/:id/complete
   * Complete session and generate summary
   */
  app.post('/api/v5/replay/session/:id/complete', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    
    try {
      const summary = await replayService.completeSession(id);
      
      return reply.send({
        ok: true,
        data: {
          session_id: id,
          summary,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'COMPLETE_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v5/replay/session/:id
   * Get session details
   */
  app.get('/api/v5/replay/session/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    
    try {
      const session = await replayService.getSession(id);
      
      if (!session) {
        return reply.status(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: `Session ${id} not found`,
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          session_id: session.session_id,
          asset: session.asset,
          timeRange: session.timeRange,
          status: session.status,
          stats: session.stats,
          results: session.results,
          mode: session.mode,
          createdAt: session.createdAt,
          completedAt: session.completedAt,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'GET_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v5/replay/session/:id/signals
   * Get all signals for a session
   */
  app.get('/api/v5/replay/session/:id/signals', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    
    try {
      const signals = await replayService.getSessionSignals(id);
      
      return reply.send({
        ok: true,
        data: {
          session_id: id,
          count: signals.length,
          signals: signals.map(s => ({
            tweet_id: s.tweet_id,
            t0_timestamp: s.t0_timestamp,
            sentiment: s.sentiment,
            prices: s.prices,
            reactions: s.reactions,
            outcomes: s.outcomes,
            text: s.meta.text.substring(0, 100) + '...',
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'GET_SIGNALS_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v5/replay/sessions
   * List all replay sessions
   */
  app.get('/api/v5/replay/sessions', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessions = await replayService.listSessions();
      
      return reply.send({
        ok: true,
        data: {
          count: sessions.length,
          sessions: sessions.map(s => ({
            session_id: s.session_id,
            asset: s.asset,
            status: s.status,
            stats: s.stats,
            edgeAssessment: s.results?.edgeAssessment,
            createdAt: s.createdAt,
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'LIST_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v5/replay/generate-tweets
   * Generate synthetic tweets for large-scale testing
   * Uses realistic crypto tweet patterns
   */
  app.post('/api/v5/replay/generate-tweets', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      asset: 'BTC' | 'ETH' | 'SOL';
      count: number;
      startDate: string;
      intervalMinutes?: number;
    };
    
    if (!body.asset || !body.count || !body.startDate) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'asset, count, and startDate are required',
      });
    }
    
    // Tweet templates by sentiment type
    const bullishTemplates = [
      `$${body.asset} breaking out! Major support holding strong. Very bullish setup forming.`,
      `Huge accumulation happening on ${body.asset}. Whales are loading up. Bull run incoming!`,
      `${body.asset} technical analysis: golden cross forming. This is extremely bullish!`,
      `Just bought more ${body.asset}. The fundamentals have never been stronger. Moon soon!`,
      `Institutional buying pressure on ${body.asset} is insane right now. Bullish AF!`,
      `${body.asset} about to explode. Mark my words. This is the bottom.`,
      `The ${body.asset} chart looks beautiful. Breakout imminent. Load up now!`,
      `${body.asset} ETF inflows hitting records. Smart money is accumulating.`,
      `Bullish divergence on ${body.asset}. This is a textbook buy signal.`,
      `${body.asset} is coiling for a massive move up. Don't miss this opportunity!`,
    ];
    
    const bearishTemplates = [
      `$${body.asset} looking weak. Breakdown below support likely. Be careful out there.`,
      `Selling pressure on ${body.asset} increasing. Whales moving to exchanges. Bearish!`,
      `${body.asset} technical analysis: death cross forming. Time to take profits.`,
      `Just sold my ${body.asset}. Risk/reward not favorable here. Will rebuy lower.`,
      `${body.asset} rejection at resistance. This is going lower. Short opportunity.`,
      `The ${body.asset} chart is scary. Lower highs, lower lows. Bearish trend confirmed.`,
      `${body.asset} about to dump hard. The signs are everywhere. Exit while you can.`,
      `Massive sell walls on ${body.asset}. Someone knows something. Bearish.`,
      `${body.asset} losing momentum. RSI divergence screaming sell. Be careful!`,
      `Distribution pattern on ${body.asset}. Smart money is exiting. Wake up!`,
    ];
    
    const neutralTemplates = [
      `Watching ${body.asset} price action today. No clear direction yet. Waiting for confirmation.`,
      `${body.asset} consolidating in a tight range. Could go either way from here.`,
      `Not sure about ${body.asset} right now. The market seems undecided.`,
      `${body.asset} holding support but not breaking out. Patience is key.`,
      `Interesting price action on ${body.asset}. Need more data before making a move.`,
      `${body.asset} at a critical level. This could be big either way.`,
      `Sideways movement on ${body.asset}. Waiting for volatility to pick up.`,
      `${body.asset} trapped in a range. Breakout direction unclear.`,
      `Monitoring ${body.asset} closely. No trades until we get clarity.`,
      `${body.asset} looking neutral. Market makers in control right now.`,
    ];
    
    const shitpostTemplates = [
      `${body.asset} to the moon! LFG! 🚀🚀🚀`,
      `If you're not buying ${body.asset} right now you're NGMI`,
      `${body.asset} number go up technology activated`,
      `Wen ${body.asset} $1M? Asking for a friend`,
      `${body.asset} bears in shambles rn lmaooo`,
      `My ${body.asset} bags are ready. Are yours?`,
      `${body.asset} price prediction: up or down, probably`,
      `Still holding ${body.asset}. Diamond hands only.`,
      `${body.asset} haters gonna hate. I'm still buying.`,
      `gm ${body.asset} gang! Today we pump!`,
    ];
    
    const tweets: ReplayTweet[] = [];
    const startTime = new Date(body.startDate).getTime();
    const interval = (body.intervalMinutes || 10) * 60 * 1000;
    
    for (let i = 0; i < body.count; i++) {
      // Distribute: 30% bullish, 25% bearish, 25% neutral, 20% shitpost
      const rand = Math.random();
      let text: string;
      
      if (rand < 0.30) {
        text = bullishTemplates[Math.floor(Math.random() * bullishTemplates.length)];
      } else if (rand < 0.55) {
        text = bearishTemplates[Math.floor(Math.random() * bearishTemplates.length)];
      } else if (rand < 0.80) {
        text = neutralTemplates[Math.floor(Math.random() * neutralTemplates.length)];
      } else {
        text = shitpostTemplates[Math.floor(Math.random() * shitpostTemplates.length)];
      }
      
      // Add some variation
      if (Math.random() > 0.7) {
        text += ` #${body.asset} #crypto`;
      }
      
      tweets.push({
        tweet_id: `gen_${body.asset}_${i}_${Date.now()}`,
        text,
        created_at: new Date(startTime + i * interval),
        author_id: `author_${Math.floor(Math.random() * 1000)}`,
        author_username: `CryptoUser${Math.floor(Math.random() * 10000)}`,
      });
    }
    
    return reply.send({
      ok: true,
      data: {
        asset: body.asset,
        count: tweets.length,
        startDate: body.startDate,
        endDate: tweets[tweets.length - 1]?.created_at,
        tweets,
        distribution: {
          bullish: '~30%',
          bearish: '~25%',
          neutral: '~25%',
          shitpost: '~20%',
        },
      },
    });
  });
  
  console.log('[Replay] S5.6.H Historical Replay routes registered');
}
