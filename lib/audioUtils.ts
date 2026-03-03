const TARGET_SAMPLE_RATE = 16000;

export async function decodeAudioFile(file: File): Promise<Float32Array> {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    // Mix down to mono
    const numberOfChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const mono = new Float32Array(length);

    if (numberOfChannels === 1) {
      mono.set(audioBuffer.getChannelData(0));
    } else {
      for (let ch = 0; ch < numberOfChannels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
          mono[i] += channelData[i];
        }
      }
      const scale = 1 / numberOfChannels;
      for (let i = 0; i < length; i++) {
        mono[i] *= scale;
      }
    }

    return mono;
  } finally {
    await audioContext.close();
  }
}
