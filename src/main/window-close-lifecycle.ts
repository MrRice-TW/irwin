export function shouldCheckShellDrafts({
  shuttingDown,
  allowWindowClose,
}: {
  shuttingDown: boolean;
  allowWindowClose: boolean;
}) {
  return !shuttingDown && !allowWindowClose;
}
