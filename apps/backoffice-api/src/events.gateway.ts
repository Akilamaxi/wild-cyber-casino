import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnModuleInit } from '@nestjs/common';
import { DbService, PubSubService } from '@cyber-casino/shared';

@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly db: DbService,
    private readonly pubsub: PubSubService
  ) {}

  onModuleInit() {
    this.pubsub.on('message', (message: any) => {
      console.log(`[BACKOFFICE] Relaying Pub/Sub message to WebSockets: ${message.type}`);
      this.server.emit('lottery_events', message);
    });
  }

  handleConnection(client: Socket) {
    console.log(`[BACKOFFICE] WebSocket client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`[BACKOFFICE] WebSocket client disconnected: ${client.id}`);
  }

  @SubscribeMessage('request_initial_state')
  async handleInitialStateRequest(client: Socket) {
    try {
      const activeDraw = await this.db.get('SELECT id, state, timestamp FROM lottery_draws ORDER BY id DESC LIMIT 1');
      const ksSetting = await this.db.get("SELECT value FROM game_settings WHERE key = 'kill_switch_active'");
      
      client.emit('initial_state', {
        draw: activeDraw,
        killSwitchActive: ksSetting ? ksSetting.value === 'true' : false
      });
    } catch (err) {
      console.error(err);
    }
  }
}
