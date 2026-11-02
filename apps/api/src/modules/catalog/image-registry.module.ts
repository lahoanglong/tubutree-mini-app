import { Module } from '@nestjs/common';
import { ImageRegistryStale } from './image-registry-stale';

@Module({ providers: [ImageRegistryStale], exports: [ImageRegistryStale] })
export class ImageRegistryModule {}
