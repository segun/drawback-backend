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
import { CreateGroupDto } from './dto/create-group.dto';
import { AddGroupMemberDto } from './dto/add-group-member.dto';
import { RespondGroupInvitationDto } from './dto/respond-group-invitation.dto';

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

  // ── Groups ───────────────────────────────────────────────────────────────

  @Post('groups')
  createGroup(@CurrentUser() user: User, @Body() dto: CreateGroupDto) {
    return this.chatService.createGroup(user.id, dto);
  }

  @Get('groups')
  getUserGroups(@CurrentUser() user: User) {
    return this.chatService.getUserGroups(user.id);
  }

  @Get('groups/:groupId')
  async getGroup(
    @CurrentUser() user: User,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ) {
    const group = await this.chatService.getGroupById(groupId);
    if (!group) {
      throw new NotFoundException('Group not found');
    }
    const isMember = group.members.some((m) => m.userId === user.id);
    if (!isMember) {
      throw new NotFoundException('Group not found');
    }
    return group;
  }

  @Post('groups/:groupId/members')
  inviteMember(
    @CurrentUser() user: User,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: AddGroupMemberDto,
  ) {
    return this.chatService.inviteMember(groupId, user.id, dto);
  }

  @Delete('groups/:groupId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() user: User,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.chatService.removeMember(groupId, user.id, userId);
  }

  @Delete('groups/:groupId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteGroup(
    @CurrentUser() user: User,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ) {
    await this.chatService.deleteGroup(groupId, user.id);
  }

  // ── Group Invitations ────────────────────────────────────────────────────

  @Get('groups/invitations/pending')
  getPendingInvitations(@CurrentUser() user: User) {
    return this.chatService.getPendingGroupInvitations(user.id);
  }

  @Post('groups/invitations/:invitationId/respond')
  respondToInvitation(
    @CurrentUser() user: User,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Body() dto: RespondGroupInvitationDto,
  ) {
    return this.chatService.respondToGroupInvitation(
      invitationId,
      user.id,
      dto,
    );
  }
}
