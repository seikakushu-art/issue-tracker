export function getAvatarInitial(identifier: string, fallback = '?'): string {
    const value = (identifier ?? '').trim();
    if (!value) {
      return fallback;
    }
    const firstChar = value[0];
    return firstChar.toUpperCase();
  }
  
  export function getAvatarColor(identifier: string): string {
    const value = identifier ?? '';
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    const saturation = 65;
    const lightness = 55;
    return `hsl(${hue} ${saturation}% ${lightness}%)`;
  }
  