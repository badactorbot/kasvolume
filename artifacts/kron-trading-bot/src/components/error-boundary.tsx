import { Component, ReactNode } from "react"
import { AlertCircle } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

interface Props {
  children: ReactNode
  resetKey?: any
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidUpdate(prevProps: Props) {
    if (this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false, error: null })
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[400px] w-full items-center justify-center p-6">
          <Alert variant="destructive" className="max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription className="mt-2 text-xs font-mono break-all">
              {this.state.error?.message || "An unexpected error occurred."}
            </AlertDescription>
          </Alert>
        </div>
      )
    }

    return this.props.children
  }
}
