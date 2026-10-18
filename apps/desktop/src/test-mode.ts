// Automated desktop checks must never activate the app or display native UI.
export const desktopTest = process.env.OPENCREASE_DESKTOP_TEST === "1";
