const defaultRegisteredCommandNames = ['verify', 'healthcheck'];

let registeredCommandNames: string[] = [];

export function setRegisteredCommandNames(commandNames: string[]): void {
  registeredCommandNames = [...commandNames];
}

export function getRegisteredCommandNamesState(): string[] {
  if (registeredCommandNames.length === 0) {
    return [...defaultRegisteredCommandNames];
  }
  return [...registeredCommandNames];
}
