import React, { useRef } from "react";
import io from "socket.io-client";
import IoContext from "./IoContext";

import {
  CreateConnectionFunc,
  GetConnectionFunc,
  IoConnection,
  IoNamespace,
  SocketLike,
  SocketState,
} from "./types";

const IoProvider = function ({ children }: React.PropsWithChildren<{}>) {
  const connections = useRef<Record<string, number>>({});
  const eventSubscriptions = useRef<Record<string, number>>({});
  const sockets = useRef<
    Record<
      IoNamespace,
      {
        socket: IoConnection;
      } & SocketState
    >
  >({});

  const createConnection: CreateConnectionFunc<any> = (
    namespaceKey,
    urlConfig,
    options = {}
  ) => {
    if (!(namespaceKey in connections.current)) {
      connections.current[namespaceKey] = 1;
    } else {
      connections.current[namespaceKey] += 1;
    }

    const cleanup = () => {
      if (--connections.current[namespaceKey] === 0) {
        const socketsToClose = Object.keys(sockets.current).filter((key) =>
          key.includes(namespaceKey)
        );

        for (const key of socketsToClose) {
          sockets.current[key].socket.disconnect();
          sockets.current[key].subscribers.clear();
          delete sockets.current[key];
        }
      }
    };

    // By default socket.io-client creates a new connection for the same namespace
    // The next line prevents that
    if (sockets.current[namespaceKey]) {
      sockets.current[namespaceKey].socket.connect();
      return {
        cleanup,
        ...sockets.current[namespaceKey],
      };
    }

    const handleConnect = () => {
      sockets.current[namespaceKey].state.status = "connected";
      sockets.current[namespaceKey].notify("connected");
    };

    const handleDisconnect = () => {
      sockets.current[namespaceKey].state.status = "disconnected";
      sockets.current[namespaceKey].notify("disconnected");
    };

    const socket = io(urlConfig.source, options) as SocketLike;
    socket.namespaceKey = namespaceKey;

    sockets.current = Object.assign({}, sockets.current, {
      [namespaceKey]: {
        socket,
        state: {
          status: "disconnected",
          lastMessage: {},
          error: null,
        },
        notify: (event: string) => {
          sockets.current[namespaceKey].subscribers.forEach((callback) =>
            callback(sockets.current[namespaceKey].state, event)
          );
        },
        subscribers: new Set(),
        subscribe: (callback) => {
          sockets.current[namespaceKey]?.subscribers.add(callback);
          return () =>
            sockets.current[namespaceKey]?.subscribers.delete(callback);
        },
      },
    });

    const handleError = (error) => {
      sockets.current[namespaceKey].state.error = error;
      sockets.current[namespaceKey].notify("error");
    };
    socket.on("error", handleError);
    socket.on("connect_error", handleError);

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    return {
      cleanup,
      ...sockets.current[namespaceKey],
    };
  };

  const getConnection: GetConnectionFunc<any> = (namespaceKey = "") =>
    sockets.current[namespaceKey];

  const registerSharedListener = (namespaceKey = "", forEvent = "") => {
    if (
      sockets.current[namespaceKey] &&
      !sockets.current[namespaceKey].socket.hasListeners(forEvent)
    ) {
      sockets.current[namespaceKey].socket.on(forEvent, (message) => {
        sockets.current[namespaceKey].state.lastMessage[forEvent] = message;
        sockets.current[namespaceKey].notify("message");
      });
    }
    const subscriptionKey = `${namespaceKey}${forEvent}`;
    const cleanup = () => {
      if (--eventSubscriptions.current[subscriptionKey] === 0) {
        delete eventSubscriptions.current[subscriptionKey];
        if (sockets.current[namespaceKey])
          delete sockets.current[namespaceKey].state.lastMessage[forEvent];
      }
    };

    if (!(subscriptionKey in eventSubscriptions.current)) {
      eventSubscriptions.current[subscriptionKey] = 1;
    } else {
      eventSubscriptions.current[subscriptionKey] += 1;
    }

    return () => cleanup();
  };

  return (
    <IoContext.Provider
      value={{
        createConnection,
        getConnection,
        registerSharedListener,
      }}
    >
      {children}
    </IoContext.Provider>
  );
};

export default IoProvider;
