import { IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Min } from 'class-validator';
import { JOB_TYPES, type JobType } from '../types';

export class CreateJobV1Dto {
  @IsOptional() @IsString() @Matches(/^[a-z][a-z0-9_-]{1,63}$/) queue?: string;
  @IsIn(JOB_TYPES) type!: JobType;
  @IsOptional() @IsString() tenant_id?: string;
  @IsOptional() @IsObject() payload?: Record<string, any>;
  @IsOptional() @IsInt() @Min(1) max_attempts?: number;
}
