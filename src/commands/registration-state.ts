let registeredCommandNames: string[] = [];
let fallbackRegisteredCommandNames: string[] = [];

export function setRegisteredCommandNames(commandNames: string[]): void {
  registeredCommandNames = [...commandNames];
}

export function setRegisteredCommandNameFallback(commandNames: string[]): void {
  fallbackRegisteredCommandNames = [...commandNames];
}

export function getRegisteredCommandNamesState(): string[] {
  if (registeredCommandNames.length === 0) {
    return [...fallbackRegisteredCommandNames];
  }
  return [...registeredCommandNames];
}
