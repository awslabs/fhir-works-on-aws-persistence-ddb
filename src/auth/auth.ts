import { AxiosInstance } from 'axios';

export default interface Auth {
    // Hook into axios and intercept requests to add Auth tokens
    // https://masteringjs.io/tutorials/axios/interceptors
    attachInterceptor(axiosInstance: AxiosInstance): void;
}
