import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { ChatService } from './chat.service';
import { CreateChatRequestDto } from './dto/create-chat-request.dto';
import { RespondChatRequestDto } from './dto/respond-chat-request.dto';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ── Requests ────────────────────────────────────────────────────────────

  @Post('requests')
  createRequest(
    @CurrentUser() user: User,
    @Body() dto: CreateChatRequestDto,
  ) {
    return this.chatService.createRequest(user.id, dto);
  }

  @Get('requests/sent')
  getSent(@CurrentUser() user: User) {
    return this.chatService.getSentRequests(user.id);
  }

  @Get('requests/received')
  getReceived(@CurrentUser() user: User) {
    return this.chatService.getReceivedRequests(user.id);
  }

  @Post('requests/:requestId/respond')
  respond(
    @CurrentUser() user: User,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RespondChatRequestDto,
  ) {
    return this.chatService.respondToRequest(requestId, user.id, dto);
  }

  @Delete('requests/:requestId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancelRequest(
    @CurrentUser() user: User,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    await this.chatService.cancelRequest(requestId, user.id);
  }

  // ── Saved chats ─────────────────────────────────────────────────────────

  @Post('requests/:requestId/save')
  saveChat(
    @CurrentUser() user: User,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.chatService.saveChat(requestId, user.id);
  }

  @Get('saved')
  getSavedChats(@CurrentUser() user: User) {
    return this.chatService.getSavedChats(user.id);
  }

  @Delete('saved/:savedChatId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSavedChat(
    @CurrentUser() user: User,
    @Param('savedChatId', ParseUUIDPipe) savedChatId: string,
  ) {
    await this.chatService.deleteSavedChat(savedChatId, user.id);
  }
}
