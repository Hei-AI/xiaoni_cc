const sharp = () => ({
  webp: () => ({
    toBuffer: async () => Buffer.from('mock-webp')
  })
});

export default sharp;
