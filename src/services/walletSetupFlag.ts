let _inProgress = false;

export const walletSetupFlag = {
  begin: () => { _inProgress = true; },
  end:   () => { _inProgress = false; },
  isActive: () => _inProgress,
};
