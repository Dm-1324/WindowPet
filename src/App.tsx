import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import React, { Suspense } from "react";
import Loading from "./Loading";
import { useSettings } from "./hooks/useSettings";
import { appWindow } from "@tauri-apps/api/window";
import { useDefaultPets, usePets } from "./hooks/usePets";
import { confirm } from "@tauri-apps/api/dialog";
import { MantineProvider } from "@mantine/core";
import { cssVariablesResolver, theme } from "./theme";
import { ColorSchemeType } from "./types/ISetting";

const PhaserWrapper = React.lazy(() => import("./PhaserWrapper"));
const SettingWindow = React.lazy(() => import("./SettingWindow"));

function App() {
  useSettings();
  useDefaultPets();
  const { isError, error } = usePets();

  if (isError) {
    confirm(`Error: ${error.message}`, {
      title: 'WindowPet Dialog',
      type: 'error',
    }).then((ok) => {
      if (ok !== undefined) {
        appWindow.close();
      }
    });
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={<PhaserWrapper />} />
        <Route path="/setting" element={
          <Suspense fallback={<Loading />}>
            <MantineProvider
              defaultColorScheme={ColorSchemeType.Dark}
              theme={theme}
              cssVariablesResolver={cssVariablesResolver}>
              <SettingWindow />
            </MantineProvider>
          </Suspense>
        } />
      </Routes>
    </Router>
  );
}

export default App;