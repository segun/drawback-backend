import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
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
  async createRequest(
    @CurrentUser() user: User,
    @Body() dto: CreateChatRequestDto,
  ) {
    const request = await this.chatService.createRequest(user.id, dto);
    if (!request) {
      throw new NotFoundException('Target user not found');
    }

    return request;
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
  async respond(
    @CurrentUser() user: User,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RespondChatRequestDto,
  ) {
    const result = await this.chatService.respondToRequest(
      requestId,
      user.id,
      dto,
    );
    if (!result) {
      throw new NotFoundException('Chat request not found');
    }

    return result;
  }

  @Delete('requests/:requestId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancelRequest(
    @CurrentUser() user: User,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    const cancelled = await this.chatService.cancelRequest(requestId, user.id);
    if (!cancelled) {
      throw new NotFoundException('Chat request not found');
    }
  }

  @Delete('requests/:requestId/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAcceptedChat(
    @CurrentUser() user: User,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    const removed = await this.chatService.removeAcceptedChat(
      requestId,
      user.id,
    );
    if (!removed) {
      throw new NotFoundException('Chat request not found');
    }
  }

  // ── Saved chats ─────────────────────────────────────────────────────────

  @Post('requests/:requestId/save')
  async saveChat(
    @CurrentUser() user: User,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    const savedChat = await this.chatService.saveChat(requestId, user.id);
    if (!savedChat) {
      throw new NotFoundException('Chat request not found');
    }

    return savedChat;
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
    const deleted = await this.chatService.deleteSavedChat(
      savedChatId,
      user.id,
    );
    if (!deleted) {
      throw new NotFoundException('Saved chat not found');
    }
  }
}
