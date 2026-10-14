export function meetingFixtureManifest() {
  return {
    code: 'meetings', version: '1.0.0', releaseState: 'test',
    fixture: 'network-department-meeting', supportedMethods: ['qr', 'nfc']
  };
}

export function meetingSourceRef(id) { return { module: 'meetings', type: 'meeting', id }; }
