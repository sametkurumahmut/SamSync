import { describe, it, expect } from 'vitest';
import { machineLabel, machineTitle } from '../src/shared/machine';

describe('machine labels', () => {
  it('takes the address off the end of a name', () => {
    expect(machineLabel('PC-1 - 10.10.1.11', '10.10.1.11')).toEqual({ title: 'PC-1', sub: '10.10.1.11' });
    expect(machineLabel('Server – 10.10.1.10')).toEqual({ title: 'Server', sub: '10.10.1.10' });
    expect(machineLabel('NAS (nas.local)')).toEqual({ title: 'NAS', sub: 'nas.local' });
    expect(machineLabel('Lab-B PC-2 | 10.10.1.32')).toEqual({ title: 'Lab-B PC-2', sub: '10.10.1.32' });
  });

  it('keeps a hyphenated name whole and shows the configured address instead', () => {
    expect(machineLabel('PC-1', '10.10.1.11')).toEqual({ title: 'PC-1', sub: '10.10.1.11' });
    expect(machineLabel('Build - Release', '10.0.0.9')).toEqual({ title: 'Build - Release', sub: '10.0.0.9' });
    expect(machineLabel('Lab-A Server', 'lab-a-server')).toEqual({ title: 'Lab-A Server', sub: 'lab-a-server' });
  });

  it('matches the node address even when it is not an IP', () => {
    expect(machineLabel('Dev - MSI', 'msi')).toEqual({ title: 'Dev', sub: 'MSI' });
    expect(machineLabel('Dev - msi', 'MSI').sub).toBe('msi');
    expect(machineLabel('Dev - MSI', '10.0.0.2')).toEqual({ title: 'Dev - MSI', sub: '10.0.0.2' });
  });

  it('has no subtitle when the name is the address', () => {
    expect(machineLabel('10.10.1.5', '10.10.1.5')).toEqual({ title: '10.10.1.5', sub: undefined });
    expect(machineLabel('', '10.10.1.5')).toEqual({ title: '10.10.1.5', sub: undefined });
    expect(machineTitle('PC-3 - 10.10.1.13')).toBe('PC-3');
  });
});
