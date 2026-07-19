import { IsEmail, IsString, IsNotEmpty, IsNumber, Min, IsArray, IsOptional } from 'class-validator';

export class SpinDto {
  @IsEmail()
  email!: string;
}

export class BetDto {
  @IsEmail()
  email!: string;

  @IsNumber()
  @Min(1)
  bet!: number;
}

export class PlinkoDropDto {
  @IsEmail()
  email!: string;

  @IsNumber()
  @Min(1)
  bet!: number;
}

export class DiceRollDto {
  @IsEmail()
  email!: string;

  @IsNumber()
  @Min(1)
  bet!: number;

  @IsString()
  @IsNotEmpty()
  prediction!: 'under' | 'over';
}

export class ReserveTicketDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsNumber()
  ticketId?: number;

  @IsOptional()
  @IsArray()
  ticketIds?: number[];
}

export class CrashCashoutDto {
  @IsEmail()
  email!: string;

  @IsNumber()
  betId!: number;
}
