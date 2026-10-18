import { describe, it, expect } from 'vitest';
import { discoverHosts, localSubnets, parseNetView, subnetHosts } from '../src/core/discover';
import { emptyConfig } from '../src/core/config';

describe('network discovery', () => {
  it('lists the addresses of a /24 without the host itself, and narrows a wider mask to the /24 around the host', () => {
    const hosts = subnetHosts('10.10.1.11', '255.255.255.0');
    expect(hosts).toHaveLength(253);
    expect(hosts[0]).toBe('10.10.1.1');
    expect(hosts).not.toContain('10.10.1.11');
    expect(hosts[hosts.length - 1]).toBe('10.10.1.254');
    const wide = subnetHosts('172.16.40.7', '255.255.0.0');
    expect(wide).toHaveLength(253);
    expect(wide[0]).toBe('172.16.40.1');
    expect(subnetHosts('192.168.1.5', '255.255.255.252')).toEqual(['192.168.1.6']);
  });

  it('takes only the real IPv4 interfaces of this computer', () => {
    const subs = localSubnets({
      Ethernet: [{ address: '10.0.0.5', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '10.0.0.5/24' }],
      Loopback: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: true, cidr: '127.0.0.1/8' }],
      WiFi: [
        { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '', internal: false, cidr: 'fe80::1/64', scopeid: 1 },
        { address: '169.254.3.3', netmask: '255.255.0.0', family: 'IPv4', mac: '', internal: false, cidr: '169.254.3.3/16' },
      ],
    } as unknown as NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>);
    expect(subs.map((s) => s.self)).toEqual(['10.0.0.5']);
    expect(subs[0].hosts).toHaveLength(253);
  });

  it('reads the disk shares out of `net view`, in any Windows language, without the administrative ones', () => {
    const en = `Shared resources at \\\\10.0.0.9\n\nShare name  Type  Used as  Comment\n\n-------------------------------------------------------------------------------\nRelease     Disk           The release share\nUsers       Disk\nPrinter1    Print\nADMIN$      Disk           Remote Admin\nThe command completed successfully.\n`;
    expect(parseNetView(en)).toEqual(['Release', 'Users']);
    const tr = `\\\\10.0.0.9 üzerindeki paylaşılan kaynaklar\n\nPaylaşım adı  Tür   Kullanılan  Açıklama\n\n-------------------------------------------------------------------------------\nShare         Disk\nMy Share      Disk              with a space\nC$            Disk              Varsayılan paylaşım\nKomut başarıyla tamamlandı.\n`;
    expect(parseNetView(tr)).toEqual(['Share', 'My Share']);
    expect(parseNetView('System error 53 has occurred.')).toEqual([]);
  });

  it('reports the hosts that answer, with names, shares and the node they already are', async () => {
    const cfg = { ...emptyConfig(), nodes: [{ id: 'PC-1', name: 'PC-1', address: '10.0.0.11', localRoots: [], networkRoot: 'Share\\Release', enabled: true }] };
    const progress: number[] = [];
    const open = new Set(['10.0.0.11:445', '10.0.0.12:445', '10.0.0.12:22', '10.0.0.20:22']);
    const hosts = await discoverHosts(cfg, {
      subnets: [{ self: '10.0.0.5', iface: 'eth', hosts: ['10.0.0.5', '10.0.0.11', '10.0.0.12', '10.0.0.13', '10.0.0.20'] }],
      probe: async (ip, port) => open.has(`${ip}:${port}`),
      names: async (ip) => (ip === '10.0.0.12' ? 'nas.local' : undefined),
      shares: async (ip) => (ip === '10.0.0.12' ? ['Data', 'Media'] : []),
      onProgress: (done) => progress.push(done),
    });
    expect(hosts.map((h) => h.address)).toEqual(['10.0.0.11', '10.0.0.12', '10.0.0.20']);
    expect(hosts[0].nodeId).toBe('PC-1');
    expect(hosts[1]).toMatchObject({ hostname: 'nas.local', ports: [445, 22], shares: ['Data', 'Media'] });
    expect(hosts[2].shares).toBeUndefined();
    expect(progress[progress.length - 1]).toBe(4); // the computer's own address is not tried
  });
});
