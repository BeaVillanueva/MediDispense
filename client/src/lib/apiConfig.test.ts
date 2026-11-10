import { expect, it } from "vitest";
import { resolveApiBase } from "./apiConfig";
it("follows the browser hostname for local development", () => {
  const configured="http://localhost/medidispense/backend/public";
  expect(resolveApiBase(configured,true,"localhost")).toBe(configured);
  expect(resolveApiBase(configured,true,"192.168.1.65")).toBe("http://192.168.1.65/medidispense/backend/public");
  expect(resolveApiBase("",true,"10.0.0.5")).toBe("http://10.0.0.5/medidispense/backend/public");
});
it("preserves explicit production and remote API URLs", () => {
  expect(resolveApiBase("https://api.example.com/",true,"192.168.1.65")).toBe("https://api.example.com");
  expect(resolveApiBase("https://api.example.com/",false,"localhost")).toBe("https://api.example.com");
  expect(resolveApiBase("",false,"example.com")).toBe("");
});
it("repairs production localhost URLs on another LAN device and preserves explicit ports and relative paths",()=>{
  expect(resolveApiBase("http://localhost/medidispense/backend/public",false,"192.168.1.81")).toBe("http://192.168.1.81/medidispense/backend/public");
  expect(resolveApiBase("",false,"192.168.1.81")).toBe("http://192.168.1.81/medidispense/backend/public");
  expect(resolveApiBase("http://localhost:8080/medidispense/backend/public/",true,"192.168.1.81")).toBe("http://192.168.1.81:8080/medidispense/backend/public");
  expect(resolveApiBase("/medidispense/backend/public/",false,"192.168.1.81")).toBe("/medidispense/backend/public");
  expect(resolveApiBase("",true,"192.168.1.81","https:")).toBe("https://192.168.1.81/medidispense/backend/public");
});
