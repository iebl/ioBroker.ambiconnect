// This file extends the AdapterConfig type from "@types/iobroker"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
	namespace ioBroker {
		interface AdapterConfig {
			host: string;
			port: number;
			username: string;
			password: string;
			deviceTopic: string;
			controlEnabled: boolean;
			minPowerW: number;
			rampFactor: number;
			rampIntervalMs: number;
			measurementIntervalMs: number;
			measurementDeadband: number;
		}
	}
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
