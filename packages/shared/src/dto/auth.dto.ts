import { IsEmail, IsString, IsNotEmpty, IsOptional, MinLength, IsNumber, Min, Max, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @IsEmail({}, { message: 'Valid email is required' })
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  @IsString()
  deviceFingerprint?: string;

  @IsOptional() @IsString() @Matches(/^\d{6}$/)
  mfaCode?: string;
}

export class RegisterDto {
  @IsEmail({}, { message: 'Valid email is required' })
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128)
  password!: string;

  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsOptional()
  @IsString()
  deviceFingerprint?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' && value.trim() === '' ? undefined : value?.trim())
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'Referral code contains invalid characters' })
  referralCode?: string;
}

export class WalletAddressDto {
  @IsString()
  @IsNotEmpty()
  walletAddress!: string;
}

export class AmountDto {
  @IsString()
  @IsNotEmpty()
  email!: string; // Note: usually extracted from JWT, but currently sent in body

  @IsNumber()
  @Min(0.01)
  amount!: number;
}

export class PaymentWebhookDto {
  @IsString() @IsNotEmpty() @MaxLength(128)
  providerTransactionId!: string;

  @IsEmail()
  email!: string;

  @IsNumber() @Min(0.01) @Max(1_000_000)
  amount!: number;

  @IsString() @Matches(/^[A-Z]{3,8}$/)
  currency!: string;
}
