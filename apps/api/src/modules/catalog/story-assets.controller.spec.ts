import 'reflect-metadata';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { StoryAssetsController } from './story-assets.controller';

describe('StoryAssetsController', () => {
  it('requires ADMIN role', () => {
    expect(Reflect.getMetadata(ROLES_KEY, StoryAssetsController)).toEqual(['ADMIN']);
  });

  it('forwards id and body to the service', async () => {
    const svc = { extract: jest.fn().mockResolvedValue({ images: [], cutouts: [] }) };
    const ctrl = new StoryAssetsController(svc as never);
    await ctrl.extract('p1', { pageUrl: 'https://example.com' });
    expect(svc.extract).toHaveBeenCalledWith('p1', { pageUrl: 'https://example.com' });
  });
});
