export interface AIResponse {
    success: boolean;
    message: string;
    data?: any;
}

export interface CommandRequest {
    command: string;
    userId: string;
}