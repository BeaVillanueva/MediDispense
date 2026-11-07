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
