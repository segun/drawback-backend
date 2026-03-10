import { IsEnum, IsString, MinLength } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

export enum SearchField {
  EMAIL = 'email',
  DISPLAY_NAME = 'displayName',
}

export class UserSearchQueryDto extends PaginationQueryDto {
  @IsString()
  @MinLength(1)
  q!: string;

  @IsEnum(SearchField)
  searchField!: SearchField;
}
