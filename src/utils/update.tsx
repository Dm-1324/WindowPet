import {
  checkUpdate,
  installUpdate,
  onUpdaterEvent,
} from '@tauri-apps/api/updater'
import { relaunch } from '@tauri-apps/api/process'
import { modals } from '@mantine/modals';
import Updater from '../ui/pop_up/Updater';
import { info, error } from "tauri-plugin-log-api";
import { ButtonVariant } from '.';
import i18next from 'i18next';
import { notifications } from '@mantine/notifications';

// Updates come from this fork's own GitHub releases (Dm-1324/WindowPet), signed
// with its own key; see tauri.conf.json -> updater.
const UPDATES_ENABLED = true;

// prompt: false only checks (used for the status line in About); true also offers to install
export const checkForUpdate = async (prompt = true) => {
  if (!UPDATES_ENABLED) return false;
  info('Checking for update');
  try {
    const { shouldUpdate, manifest } = await checkUpdate()

    if (shouldUpdate && prompt) {
      modals.close('check-for-update');
      modals.openConfirmModal({
        modalId: 'check-for-update',
        centered: true,
        title: i18next.t('Update available'),
        children: <Updater shouldUpdate={shouldUpdate} manifest={manifest} />,
        confirmProps: { variant: ButtonVariant },
        cancelProps: { variant: ButtonVariant, color: 'red' },
        labels: { confirm: i18next.t('Yes'), cancel: i18next.t('No') },
        onConfirm: () => update(),
      });
    }

    info('Update check complete');
    return shouldUpdate;
  } catch (err) {
    error(err as string);
    // couldn't reach GitHub (offline, …): neither "up to date" nor "update available"
    return null;
  }
}

export const update = async () => {
  const unlisten = await onUpdaterEvent(({ error, status }) => {
    info(`Updater event Error:${error}, Status${status}`)
    console.log('Updater event', error, status)
  })

  try {
    info('Installing update');
    await installUpdate()
    info('Update installed, relaunching app');
    await relaunch()
  } catch (err) {
    error(err as string);
    notifications.show({
      color: 'red',
      title: i18next.t("Couldn't install the update"),
      message: i18next.t('Check your internet connection and try again from About → Check for updates.'),
    });
  } finally {
    unlisten()
  }
}