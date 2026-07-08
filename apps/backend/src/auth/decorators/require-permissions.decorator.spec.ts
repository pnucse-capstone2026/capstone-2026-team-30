import { SetMetadata } from '@nestjs/common';
import {
  REQUIRED_PERMISSIONS_KEY,
  RequirePermissions,
} from './require-permissions.decorator';

jest.mock('@nestjs/common', () => ({
  SetMetadata: jest.fn(),
}));

describe('RequirePermissions', () => {
  it('stores required permission keys as route metadata', () => {
    const metadataDecorator = jest.fn();
    jest.mocked(SetMetadata).mockReturnValue(metadataDecorator);

    const result = RequirePermissions('users.read', 'users.create');

    expect(SetMetadata).toHaveBeenCalledWith(REQUIRED_PERMISSIONS_KEY, [
      'users.read',
      'users.create',
    ]);
    expect(result).toBe(metadataDecorator);
  });
});
