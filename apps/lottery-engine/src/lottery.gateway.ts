import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { DbService, PubSubService } from '@cyber-casino/shared';
import { CrashService } from './crash.service';

const chatBotMessages = [
  "Just got a 10x multiplier on Spin Wheel! Let's go! 🎡",
  "Is anyone playing the Sugar Rush 15 draw? It's about to roll!",
  "Who is SuperAdmin? Saw them claim a VIP bonus earlier. 🔥",
  "Wild! Just hit 4 matching balls in Sweet Treat 30!",
  "Depositing some BTC, hoping to hit the Grand Ganache jackpot tonight. 🪙",
  "Good luck everyone! May the RNG be with you.",
  "Check out the leaderboard, the top player is absolutely crushing it today."
];
const chatBotNames = ["NeonSpins", "LuckyByte", "JackpotRunner", "CryptoCzar", "WildDealer", "VegasGrid"];

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
})
export class LotteryGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly db: DbService,
    private readonly pubsub: PubSubService,
    @Inject(forwardRef(() => CrashService))
    private readonly crashService: CrashService
  ) {}

  onModuleInit() {
    // Relayer for background pubsub drawing events to active WebSockets clients
    this.pubsub.on('message', (message: any) => {
      if (message && message.type !== 'KILL_SWITCH') {
        console.log(`[LOTTERY ENGINE] Relaying event to WebSockets: ${message.type}`);
        this.server.emit('lottery_events', message);
        if (message.type === 'DICE_CONFIG_UPDATED') {
          this.server.emit('dice_events', { type: 'DICE_TOURNEY_CREATED' });
        }
      }
    });

    // Boot up crash service with WS server instance
    this.crashService.setServer(this.server);
    this.crashService.start().catch(err => {
      console.error('[CRASH] Initialization error:', err);
    });

    // Start periodic simulated chat bot interactions to make the casino lobby feel alive
    setInterval(() => {
      const randomName = chatBotNames[Math.floor(Math.random() * chatBotNames.length)];
      const randomMsg = chatBotMessages[Math.floor(Math.random() * chatBotMessages.length)];
      this.server.emit('chat_message', {
        username: randomName,
        email: `${randomName.toLowerCase()}@bot.casino`,
        message: randomMsg,
        role: 'USER',
        timestamp: new Date().toISOString()
      });
    }, 45000);
  }

  handleConnection(client: Socket) {
    console.log(`[LOTTERY ENGINE] Client connected to WebSockets: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`[LOTTERY ENGINE] Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('request_initial_state')
  async handleInitialStateRequest(client: Socket) {
    try {
      const activeDraws: Record<string, any> = {};
      const games = await this.db.all("SELECT * FROM games_config WHERE status = 'ACTIVE'");
      
      for (const g of games) {
        let draw = await this.db.get('SELECT * FROM lottery_draws WHERE lotteryName = ? ORDER BY id DESC LIMIT 1', [g.name]);
        if (!draw) {
          await this.db.run('INSERT INTO lottery_draws (lotteryName, state, winningNumbers, timestamp) VALUES (?, "OPEN", NULL, ?)', [g.name, new Date().toISOString()]);
          draw = await this.db.get('SELECT * FROM lottery_draws WHERE lotteryName = ? ORDER BY id DESC LIMIT 1', [g.name]);
        }
        activeDraws[g.name] = draw;
      }
      
      const ksSetting = await this.db.get("SELECT value FROM game_settings WHERE key = 'kill_switch_active'");
      
      client.emit('initial_state', {
        draws: activeDraws,
        killSwitchActive: ksSetting ? ksSetting.value === 'true' : false
      });
    } catch (err) {
      console.error('[LOTTERY ENGINE WS ERROR]', err);
    }
  }

  @SubscribeMessage('send_chat_message')
  async handleChatMessage(client: Socket, data: any) {
    if (!data || !data.message) return;
    
    // Broadcast user's message
    this.server.emit('chat_message', {
      username: data.username || 'Guest',
      email: data.email || 'guest@casino.com',
      message: data.message.substring(0, 200), // Limit length
      role: data.role || 'USER',
      timestamp: new Date().toISOString()
    });

    // Automated Agent Chatbot responder logic
    const msgLower = data.message.toLowerCase();
    let reply = '';

    if (msgLower.includes('deposit')) {
      reply = `@${data.username} To deposit funds, navigate to the "Wallet Dashboard" in the sidebar and choose Credit Card or Crypto via our secure CyberPay checkout.`;
    } else if (msgLower.includes('withdraw')) {
      reply = `@${data.username} Withdrawals are processed immediately to external routing accounts. Set your withdrawal amount under the "Wallet Dashboard".`;
    } else if (msgLower.includes('vip') || msgLower.includes('loyalty') || msgLower.includes('points') || msgLower.includes('silver') || msgLower.includes('gold')) {
      reply = `@${data.username} VIP levels are updated automatically based on your wagers! Reach Silver for a $50 cash bonus, or Gold for a $250 bonus. Track progress in your User Profile page.`;
    } else if (msgLower.includes('lottery') || msgLower.includes('ticket') || msgLower.includes('game') || msgLower.includes('play')) {
      reply = `@${data.username} We host multiple draw pools (from 15s to 900s). Pick your numbers in "Cyber Lottery" and wagers will update dynamically on draw completions!`;
    } else if (msgLower.includes('help') || msgLower.includes('support') || msgLower.includes('agent')) {
      reply = `@${data.username} Hello! I am Agent Neo, your automated support chatbot. How can I assist you with games, VIP status, or payments today?`;
    }

    if (reply) {
      setTimeout(() => {
        this.server.emit('chat_message', {
          username: 'Agent Neo',
          email: 'agent.neo@support.casino',
          message: reply,
          role: 'ADMIN',
          timestamp: new Date().toISOString()
        });
      }, 1500);
    }
  }
}
