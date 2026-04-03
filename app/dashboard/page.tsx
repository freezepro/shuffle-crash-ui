import DashboardTabs from "../components/DashboardTabs";
import PasswordGate from "../components/PasswordGate";

export default function DashboardPage() {
  return (
    <PasswordGate>
      <div
        style={{
          minHeight: "100vh",
          padding: "20px",
          background: "#020617",
          color: "white",
        }}
      >
        <DashboardTabs />
      </div>
    </PasswordGate>
  );
}
