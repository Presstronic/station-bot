let registeredCommandNames: string[] = [];

export function setRegisteredCommandNames(commandNames: string[]): void {
  registeredCommandNames = [...commandNames];
}

export function getRegisteredCommandNamesState(): string[] {
  return [...registeredCommandNames];
}
