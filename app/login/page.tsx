import LoginForm from "../components/LoginForm";

export default function LoginPage() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#020617",
        padding: "16px",
      }}
    >
      <LoginForm />
    </div>
  );
}
