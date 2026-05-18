// Root App Component — Router + Providers
import React from "react";
import { App, ZMPRouter, SnackbarProvider } from "zmp-ui";
import { RecoilRoot } from "recoil";
import Layout from "./layout";

const MyApp: React.FC = () => {
  return (
    <RecoilRoot>
      <div style={{ "--zmp-primary-color": "#2E7D32", "--zmp-background-color": "#f4f5f6" } as React.CSSProperties}>
        <App>
        <SnackbarProvider>
          <ZMPRouter>
            <Layout />
          </ZMPRouter>
        </SnackbarProvider>
      </App>
      </div>
    </RecoilRoot>
  );
};

export default MyApp;
