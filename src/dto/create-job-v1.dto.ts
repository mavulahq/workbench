import { IsIn, IsObject } from 'class-validator';
import { PUBLIC_JOB_TYPES, type PublicJobType } from '../types';

export class CreateJobV1Dto {
  @IsIn(PUBLIC_JOB_TYPES) type!: PublicJobType;
  @IsObject() payload!: Record<string, any>;
}
