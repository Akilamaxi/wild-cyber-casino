import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class TournamentActionDto { @IsInt() @Min(1) tournamentId!: number; }
export class BooleanStateDto { @IsBoolean() active!: boolean; }
export class UserStatusDto { @IsIn(['ACTIVE', 'FROZEN', 'BANNED']) status!: string; }
export class UserTagsDto { @IsArray() @ArrayMaxSize(25) @IsString({ each: true }) tags!: string[]; }

export class GameConfigDto {
  @IsOptional() @IsString() @MaxLength(80) id?: string;
  @IsString() @MaxLength(120) name!: string;
  @IsNumber() @Min(60000) @Max(86400000) draw_interval_ms!: number;
  @IsNumber() @Min(0.01) @Max(1000000) ticket_price!: number;
  @IsOptional() @IsInt() @Min(1) @Max(10000) max_tickets_per_user?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) house_edge_percentage?: number;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}

export class SpinwheelPrizeDto {
  @IsString() @MaxLength(80) text!: string;
  @IsOptional() @IsString() @MaxLength(32) color?: string;
  @IsOptional() @IsString() @MaxLength(32) textColor?: string;
  @IsNumber() @Min(0) @Max(10000) mult!: number;
  @IsOptional() @IsBoolean() isBonus?: boolean;
}

export class OrderedIdsDto { @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) orderedIds!: string[]; }

export class ConfigMapDto {
  @IsOptional() @IsString() payout_strategy?: string; @IsOptional() @IsNumber() target_rtp?: number;
  @IsOptional() symbols_config?: unknown; @IsOptional() @IsNumber() mult_under_7?: number; @IsOptional() @IsNumber() mult_exact_7?: number;
  @IsOptional() @IsNumber() mult_over_7?: number; @IsOptional() @IsNumber() mult_doubles?: number;
  @IsOptional() @IsNumber() lobby_time_ms?: number; @IsOptional() @IsNumber() house_edge?: number;
  @IsOptional() @IsNumber() min_bet?: number; @IsOptional() @IsNumber() max_bet?: number; @IsOptional() @IsNumber() max_multiplier?: number;
  @IsOptional() @IsNumber() crash_delay_ms?: number; @IsOptional() @IsNumber() rtp_bias?: number; @IsOptional() @IsNumber() throw_out_chance?: number;
  @IsOptional() @IsBoolean() wager_commission_enabled?: boolean; @IsOptional() @IsNumber() bounty_referrer_amount?: number;
  @IsOptional() @IsNumber() bounty_referee_free_drops?: number; @IsOptional() @IsNumber() min_deposit_threshold?: number;
  @IsOptional() @IsNumber() min_wager_threshold?: number; @IsOptional() @IsNumber() rank_bronze_multiplier?: number;
  @IsOptional() @IsNumber() rank_silver_multiplier?: number; @IsOptional() @IsNumber() rank_gold_multiplier?: number;
  @IsOptional() @IsNumber() rank_diamond_multiplier?: number; @IsOptional() @IsNumber() rank_silver_volume?: number;
  @IsOptional() @IsNumber() rank_gold_volume?: number; @IsOptional() @IsNumber() rank_diamond_volume?: number;
}

export class DiceTournamentDto {
  @IsString() @MaxLength(120) name!: string; @IsNumber() @Min(0) entry_fee!: number;
  @IsNumber() @Min(0) prize_pool!: number; @IsOptional() @IsString() ends_at?: string;
}

export class BonusRuleDto {
  @IsString() @MaxLength(120) ruleName!: string; @IsString() @MaxLength(80) triggerType!: string;
  @IsNumber() @Min(0) threshold!: number; @IsString() @MaxLength(80) rewardType!: string;
  @IsNumber() @Min(0) rewardAmount!: number;
}
